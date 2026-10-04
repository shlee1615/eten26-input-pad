import AppKit
import ApplicationServices
import CryptoKit

private let returnFocusCallback: AXObserverCallback = { _, _, _, context in
    guard let context else { return }
    Unmanaged<ReturnController>.fromOpaque(context).takeUnretainedValue().focusedTargetChanged()
}

final class ReturnController: DeliveryEnvironment {
    private struct Caret {
        let element: AXUIElement
        let window: AXUIElement
        let range: CFRange
        let valueDigest: Data
        var expectedDigest: Data?
        var expectedCaret: Int?
    }
    private struct Origin {
        let app: NSRunningApplication
        let destination: DeliveryDestination
        var caret: Caret?
    }
    private let preferenceKey = "InputPadReturnMode"
    private var origin: Origin?
    private var lastExternalApp: NSRunningApplication?
    private var observers: [NSObjectProtocol] = []
    private var pollTimer: Timer?
    private var lastCaptureTime: TimeInterval = 0
    private var copiedChangeCount: Int?
    private var authorizationRoundTrip = false
    private var foregroundCache = ForegroundCaretCache<Caret>()
    private var focusObserver: AXObserver?
    private var observedApplication: AXUIElement?
    private var observedField: AXUIElement?
    private var observedProcessIdentifier: Int32?
    private var restorationID: UUID?
    private var raiseRequested = false
    private var focusRequested = false
    private var rangeRequested = false
    private var captureRetry: Timer?
    private(set) var mode: DeliveryMode
    var stateChanged: (() -> Void)?
    var resultReceived: ((String, DeliveryResult, String) -> Void)?
    private var activeOperationID: String?
    private var recentResults: [String: (DeliveryResult, String)] = [:]
    private var resultOrder: [String] = []
    private var lastResult: [String: Any]?
    private lazy var flow = DeliveryFlow(environment: self) { [weak self] result in self?.finished(result) }
    var ownProcessIdentifier: Int32 { ProcessInfo.processInfo.processIdentifier }
    var isBusy: Bool { flow.isBusy }

    init() {
        mode = DeliveryMode(rawValue: UserDefaults.standard.string(forKey: preferenceKey) ?? "") ?? .copyReturn
    }

    func start() {
        let workspace = NSWorkspace.shared
        if let app = workspace.frontmostApplication, isExternal(app) { lastExternalApp = app }
        let observer = workspace.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification,
                                                               object: nil, queue: .main) { [weak self] note in
            guard let self, let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            if self.isExternal(app), !self.isAuthorizationSettings(app) {
                self.lastExternalApp = app
                self.authorizationRoundTrip = false
                if !self.isBusy { self.watch(app); self.rememberOrigin() }
            }
            self.flow.activated(processIdentifier: app.processIdentifier)
            if app.processIdentifier == self.ownProcessIdentifier && !self.isBusy {
                if ProcessInfo.processInfo.systemUptime - self.lastCaptureTime > 0.25 { self.rememberOrigin() }
                else { self.stateChanged?() }
                self.authorizationRoundTrip = false
            }
        }
        observers.append(observer)
        observers.append(workspace.notificationCenter.addObserver(forName: NSWorkspace.didTerminateApplicationNotification,
                                                                 object: nil, queue: .main) { [weak self] note in
            guard let self, let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            if self.lastExternalApp?.processIdentifier == app.processIdentifier { self.lastExternalApp = nil }
            if self.origin?.app.processIdentifier == app.processIdentifier {
                self.flow.poll()
                self.origin = nil
                self.stateChanged?()
            }
            if self.observedProcessIdentifier == app.processIdentifier { self.stopWatching() }
        })
        rememberOrigin()
        if let app = lastExternalApp { watch(app) }
    }

    private func isExternal(_ app: NSRunningApplication) -> Bool {
        app.processIdentifier != ownProcessIdentifier && app.activationPolicy == .regular && !app.isTerminated
    }

    private func isAuthorizationSettings(_ app: NSRunningApplication) -> Bool {
        authorizationRoundTrip && app.bundleIdentifier == "com.apple.systempreferences"
    }

    func rememberOrigin() {
        guard !isBusy else { return }
        let current = NSWorkspace.shared.frontmostApplication
        let candidate = current.flatMap { isExternal($0) && !isAuthorizationSettings($0) ? $0 : nil } ?? lastExternalApp
        guard let app = candidate, isExternal(app) else { return }
        let isForeground = current?.processIdentifier == app.processIdentifier
        let fresh = isForeground && AXIsProcessTrusted() ? captureCaret(processIdentifier: app.processIdentifier) : nil
        if isForeground { foregroundCache.record(processIdentifier: app.processIdentifier, snapshot: fresh) }
        let caret = foregroundCache.resolve(processIdentifier: app.processIdentifier, isForeground: isForeground, fresh: fresh)
        origin = Origin(app: app, destination: DeliveryDestination(id: UUID(), processIdentifier: app.processIdentifier,
                                                                  name: app.localizedName ?? "原程式", hasCaret: caret != nil), caret: caret)
        lastCaptureTime = ProcessInfo.processInfo.systemUptime
        stateChanged?()
    }

    func selectMode(_ value: String) {
        guard !isBusy, let next = DeliveryMode(rawValue: value) else { stateChanged?(); return }
        mode = next
        UserDefaults.standard.set(mode.rawValue, forKey: preferenceKey)
        rememberOrigin()
        stateChanged?()
    }

    var state: [String: Any] {
        var value: [String: Any] = ["mode": mode.rawValue, "targetName": origin?.destination.name ?? "", "permissionGranted": AXIsProcessTrusted(),
         "hasCaret": origin?.caret != nil, "busy": isBusy]
        if let lastResult { value["lastResult"] = lastResult }
        return value
    }

    func send(_ text: String, operationID: String) {
        if activeOperationID == operationID { stateChanged?(); return }
        if let (result, message) = recentResults[operationID] {
            resultReceived?(operationID, result, message)
            stateChanged?()
            return
        }
        guard !text.isEmpty, !isBusy, activeOperationID == nil else {
            let message = "正在處理其他送回操作，文字仍保留。"
            recordResult(operationID, result: .rejected, message: message)
            resultReceived?(operationID, .rejected, message)
            stateChanged?()
            return
        }
        activeOperationID = operationID
        restorationID = nil
        flow.begin(text: text, mode: mode, destination: origin?.destination)
        stateChanged?()
        if isBusy {
            pollTimer?.invalidate()
            let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] timer in
                guard let self else { timer.invalidate(); return }
                self.flow.poll()
                if !self.isBusy { timer.invalidate(); self.pollTimer = nil }
            }
            pollTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    func queryDelivery(_ operationID: String) {
        if let (result, message) = recentResults[operationID] {
            resultReceived?(operationID, result, message)
        } else if activeOperationID != operationID && !isBusy {
            // Missing receipt is not proof of paste failure. Keep the draft.
            resultReceived?(operationID, .pasteUnconfirmed, "找不到貼回結果；請先查看原欄位，文字仍保留。")
        }
        stateChanged?()
    }

    // Called only by the user-facing authorization button, never at startup.
    func requestAccessibility() {
        authorizationRoundTrip = true
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    func copyText(_ text: String) -> Bool {
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(text, forType: .string) else { copiedChangeCount = nil; return false }
        copiedChangeCount = NSPasteboard.general.changeCount
        return true
    }

    func targetIsAlive(_ destination: DeliveryDestination) -> Bool {
        guard let origin, origin.destination.id == destination.id, !origin.app.isTerminated,
              let live = NSRunningApplication(processIdentifier: destination.processIdentifier) else { return false }
        return live.bundleIdentifier == origin.app.bundleIdentifier && live.launchDate == origin.app.launchDate
    }

    func automaticPasteAuthorized() -> Bool { AXIsProcessTrusted() }

    func activate(_ destination: DeliveryDestination) -> Bool {
        guard targetIsAlive(destination), let app = origin?.app else { return false }
        if app.isActive { return true }
        if #available(macOS 14.0, *) {
            NSApp.yieldActivation(to: app)
            return app.activate(from: .current, options: [])
        }
        return app.activate(options: [])
    }

    func foregroundProcessIdentifier() -> Int32? { NSWorkspace.shared.frontmostApplication?.processIdentifier }

    private func watch(_ app: NSRunningApplication) {
        guard AXIsProcessTrusted(), isExternal(app) else { return }
        if observedProcessIdentifier == app.processIdentifier { observeFocusedField(); return }
        stopWatching()
        let application = AXUIElementCreateApplication(app.processIdentifier)
        // Electron documents this opt-in for exposing its web accessibility tree.
        _ = AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        var observer: AXObserver?
        guard AXObserverCreate(app.processIdentifier, returnFocusCallback, &observer) == .success, let observer else { return }
        focusObserver = observer
        observedApplication = application
        observedProcessIdentifier = app.processIdentifier
        let context = Unmanaged.passUnretained(self).toOpaque()
        for notification in [kAXFocusedUIElementChangedNotification, kAXFocusedWindowChangedNotification] {
            _ = AXObserverAddNotification(observer, application, notification as CFString, context)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        observeFocusedField()
        // Some web trees become available shortly after AXManualAccessibility is enabled.
        let timer = Timer(timeInterval: 0.25, repeats: false) { [weak self] _ in self?.focusedTargetChanged() }
        captureRetry = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func stopWatching() {
        captureRetry?.invalidate()
        captureRetry = nil
        if let observer = focusObserver {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        }
        focusObserver = nil
        observedApplication = nil
        observedField = nil
        observedProcessIdentifier = nil
    }

    private func observeFocusedField() {
        guard let observer = focusObserver, let app = observedApplication else { return }
        let field = elementAttribute(app, kAXFocusedUIElementAttribute).flatMap { editableAncestor($0) }
        if let field, let existing = observedField, CFEqual(field, existing) { return }
        if let existing = observedField {
            for notification in [kAXSelectedTextChangedNotification, kAXValueChangedNotification] {
                _ = AXObserverRemoveNotification(observer, existing, notification as CFString)
            }
        }
        observedField = field
        if let field {
            let context = Unmanaged.passUnretained(self).toOpaque()
            for notification in [kAXSelectedTextChangedNotification, kAXValueChangedNotification] {
                _ = AXObserverAddNotification(observer, field, notification as CFString, context)
            }
        }
    }

    fileprivate func focusedTargetChanged() {
        guard !isBusy, AXIsProcessTrusted(), let current = NSWorkspace.shared.frontmostApplication,
              current.processIdentifier == observedProcessIdentifier, isExternal(current), !isAuthorizationSettings(current) else { return }
        observeFocusedField()
        lastExternalApp = current
        rememberOrigin()
    }

    private func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
        AXUIElementSetMessagingTimeout(element, 0.15)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
        return value
    }

    private func elementAttribute(_ element: AXUIElement, _ key: String) -> AXUIElement? {
        guard let value = attribute(element, key), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    private func rangeAttribute(_ element: AXUIElement) -> CFRange? {
        guard let value = attribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        let rangeValue = value as! AXValue
        guard AXValueGetType(rangeValue) == .cfRange else { return nil }
        var range = CFRange(location: 0, length: 0)
        guard AXValueGetValue(rangeValue, .cfRange, &range), range.location >= 0, range.length >= 0 else { return nil }
        return range
    }

    private func stringValue(_ element: AXUIElement) -> String? {
        guard let value = attribute(element, kAXValueAttribute) as? String, value.utf16.count <= 1_000_000 else { return nil }
        return value
    }

    private func digest(_ value: String) -> Data { Data(SHA256.hash(data: Data(value.utf8))) }

    private func isSettable(_ element: AXUIElement, _ key: String) -> Bool {
        AXUIElementSetMessagingTimeout(element, 0.15)
        var settable = DarwinBoolean(false)
        return AXUIElementIsAttributeSettable(element, key as CFString, &settable) == .success && settable.boolValue
    }

    private func isEditable(_ element: AXUIElement) -> Bool {
        guard let role = attribute(element, kAXRoleAttribute) as? String, ReturnFieldPolicy.textRoles.contains(role) else { return false }
        let subrole = attribute(element, kAXSubroleAttribute) as? String
        guard subrole != "AXSecureTextField" else { return false }
        return ReturnFieldPolicy.accepts(role: role, subrole: subrole,
            enabled: (attribute(element, kAXEnabledAttribute) as? NSNumber)?.boolValue,
            readOnly: (attribute(element, "AXReadOnly") as? NSNumber)?.boolValue,
            valueSettable: isSettable(element, kAXValueAttribute),
            selectedTextSettable: isSettable(element, kAXSelectedTextAttribute),
            rangeSettable: isSettable(element, kAXSelectedTextRangeAttribute))
    }

    private func editableAncestor(_ element: AXUIElement) -> AXUIElement? {
        var current: AXUIElement? = element
        for _ in 0..<12 {
            guard let candidate = current, (attribute(candidate, kAXSubroleAttribute) as? String) != "AXSecureTextField" else { return nil }
            if isEditable(candidate) { return candidate }
            // Only follow the focused node's parents, never search other fields.
            guard (attribute(candidate, kAXRoleAttribute) as? String) != "AXWindow" else { return nil }
            current = elementAttribute(candidate, kAXParentAttribute)
        }
        return nil
    }

    private func captureCaret(processIdentifier: Int32) -> Caret? {
        let app = AXUIElementCreateApplication(processIdentifier)
        guard let focused = elementAttribute(app, kAXFocusedUIElementAttribute), let element = editableAncestor(focused),
              let window = elementAttribute(element, kAXWindowAttribute), let range = rangeAttribute(element),
              let value = stringValue(element), range.location <= value.utf16.count,
              range.length <= value.utf16.count - range.location else { return nil }
        return Caret(element: element, window: window, range: range, valueDigest: digest(value), expectedDigest: nil, expectedCaret: nil)
    }

    func restoreCaret(_ destination: DeliveryDestination, text: String) -> DeliveryCaretRestoration {
        guard targetIsAlive(destination), foregroundProcessIdentifier() == destination.processIdentifier,
              var snapshot = origin?.caret, isEditable(snapshot.element) else { return .unavailable }
        if restorationID != destination.id {
            restorationID = destination.id
            raiseRequested = false; focusRequested = false; rangeRequested = false
        }
        guard let value = stringValue(snapshot.element) else { return .pending }
        guard digest(value) == snapshot.valueDigest else { return .unavailable }
        let app = AXUIElementCreateApplication(destination.processIdentifier)
        guard let activeWindow = elementAttribute(app, kAXFocusedWindowAttribute) else { return .pending }
        if !CFEqual(activeWindow, snapshot.window) {
            if !raiseRequested {
                raiseRequested = true
                _ = AXUIElementPerformAction(snapshot.window, kAXRaiseAction as CFString)
            }
            return .pending
        }
        let focused = elementAttribute(app, kAXFocusedUIElementAttribute).flatMap({ editableAncestor($0) })
        if focused == nil || !CFEqual(focused!, snapshot.element) {
            if !focusRequested {
                guard isSettable(snapshot.element, kAXFocusedAttribute) else { return .pending }
                focusRequested = true
                _ = AXUIElementSetAttributeValue(snapshot.element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            }
            return .pending
        }
        // Activation may already have restored DOM focus; do not force an unsupported AX write.
        guard let currentRange = rangeAttribute(snapshot.element) else { return .pending }
        if currentRange.location != snapshot.range.location || currentRange.length != snapshot.range.length {
            guard isSettable(snapshot.element, kAXSelectedTextRangeAttribute) else { return .unavailable }
            if !rangeRequested {
                rangeRequested = true
                var selected = snapshot.range
                if let selection = AXValueCreate(.cfRange, &selected) {
                    _ = AXUIElementSetAttributeValue(snapshot.element, kAXSelectedTextRangeAttribute as CFString, selection)
                }
            }
            return .pending
        }
        guard let latestValue = stringValue(snapshot.element), digest(latestValue) == snapshot.valueDigest,
              snapshot.range.location <= latestValue.utf16.count,
              snapshot.range.length <= latestValue.utf16.count - snapshot.range.location else { return .unavailable }
        let expected = (latestValue as NSString).replacingCharacters(in: NSRange(location: snapshot.range.location, length: snapshot.range.length), with: text)
        snapshot.expectedDigest = digest(expected)
        snapshot.expectedCaret = snapshot.range.location + text.utf16.count
        origin?.caret = snapshot
        return .ready
    }

    func pasteOnce(_ destination: DeliveryDestination) -> Bool {
        guard readyToPaste(destination) else { return false }
        if let menuItem = pasteMenuItem(processIdentifier: destination.processIdentifier) {
            guard readyToPaste(destination) else { return false }
            // An AX action may have happened even if its reply is ambiguous. Never post a second paste.
            _ = AXUIElementPerformAction(menuItem, kAXPressAction as CFString)
            return true
        }
        guard CGPreflightPostEventAccess(), readyToPaste(destination),
              let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else { return false }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.postToPid(destination.processIdentifier)
        up.postToPid(destination.processIdentifier)
        return true
    }

    private func readyToPaste(_ destination: DeliveryDestination) -> Bool {
        guard automaticPasteAuthorized(), targetIsAlive(destination), foregroundProcessIdentifier() == destination.processIdentifier,
              let snapshot = origin?.caret, snapshot.expectedDigest != nil,
              let focus = elementAttribute(AXUIElementCreateApplication(destination.processIdentifier), kAXFocusedUIElementAttribute).flatMap({ editableAncestor($0) }),
              CFEqual(focus, snapshot.element), let range = rangeAttribute(snapshot.element),
              range.location == snapshot.range.location, range.length == snapshot.range.length,
              let value = stringValue(snapshot.element), digest(value) == snapshot.valueDigest,
              foregroundProcessIdentifier() == destination.processIdentifier,
              NSPasteboard.general.changeCount == copiedChangeCount else { return false }
        return true
    }

    private func children(_ element: AXUIElement) -> [AXUIElement] {
        guard let values = attribute(element, kAXChildrenAttribute) as? [AnyObject] else { return [] }
        return values.compactMap { value in
            guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
            return (value as! AXUIElement)
        }
    }

    private func pasteMenuItem(processIdentifier: Int32) -> AXUIElement? {
        let app = AXUIElementCreateApplication(processIdentifier)
        guard let bar = elementAttribute(app, kAXMenuBarAttribute),
              let edit = children(bar).first(where: { ["編輯", "Edit", "编辑", "編集"].contains(attribute($0, kAXTitleAttribute) as? String ?? "") }) else { return nil }
        var pending = children(edit)
        var visited = 0
        let deadline = ProcessInfo.processInfo.systemUptime + 0.5
        while !pending.isEmpty && visited < 80 && ProcessInfo.processInfo.systemUptime < deadline {
            let item = pending.removeFirst()
            visited += 1
            if (attribute(item, kAXMenuItemCmdCharAttribute) as? String)?.lowercased() == "v",
               (attribute(item, kAXMenuItemCmdModifiersAttribute) as? NSNumber)?.intValue == 0,
               (attribute(item, kAXEnabledAttribute) as? NSNumber)?.boolValue == true {
                return item
            }
            pending.append(contentsOf: children(item))
        }
        return nil
    }

    func verifyPaste(_ destination: DeliveryDestination) -> DeliveryVerification {
        guard targetIsAlive(destination), let snapshot = origin?.caret, let expected = snapshot.expectedDigest else { return .unavailable }
        // AX reads can fail briefly while the destination handles its paste command.
        guard let value = stringValue(snapshot.element), digest(value) == expected else { return .pending }
        if expected == snapshot.valueDigest {
            // Replacing a selection with identical text needs an independent caret change.
            guard let range = rangeAttribute(snapshot.element), range.length == 0,
                  range.location == snapshot.expectedCaret,
                  range.location != snapshot.range.location || range.length != snapshot.range.length else { return .pending }
        }
        // Selection/value notifications during a delivery were intentionally ignored.
        // Re-arm the cache with the confirmed field's new caret for the next return.
        let focus = elementAttribute(AXUIElementCreateApplication(destination.processIdentifier), kAXFocusedUIElementAttribute).flatMap({ editableAncestor($0) })
        if let focus, CFEqual(focus, snapshot.element), let range = rangeAttribute(snapshot.element),
           range.location <= value.utf16.count, range.length <= value.utf16.count - range.location {
            let next = Caret(element: snapshot.element, window: snapshot.window, range: range,
                             valueDigest: expected, expectedDigest: nil, expectedCaret: nil)
            foregroundCache.record(processIdentifier: destination.processIdentifier, snapshot: next)
        } else {
            foregroundCache.record(processIdentifier: destination.processIdentifier, snapshot: nil)
        }
        return .verified
    }

    private func finished(_ result: DeliveryResult) {
        pollTimer?.invalidate()
        pollTimer = nil
        let message: String
        switch result {
        case .copiedWithoutTarget: message = "已複製；請先點好目標欄位，再回到便箋。"
        case .clipboardFailed: message = "無法複製，文字仍保留在便箋。"
        case .targetUnavailable: message = "已複製；原程式或視窗已無法使用，請手動貼上。"
        case .permissionRequired: message = "已複製；一鍵送回需要輔助使用授權。"
        case .caretUnavailable: message = "已複製；無法確認原欄位，請改用「複製並返回」。"
        case .activationFailed: message = "已複製；無法切回原程式，請手動貼上。"
        case .focusChanged: message = "已複製；目的程式已切換，未送出貼上。"
        case .returned: message = "已複製並返回 · 請在原程式按 ⌘ V 貼上。"
        case .pasted: message = "已貼入原欄位 · 便箋文字已保留。"
        case .pasteUnavailable: message = "已複製；無法自動貼上，請手動貼上。"
        case .pasteUnconfirmed: message = "已送出貼上指令；請先查看原欄位，尚未確認結果。"
        case .rejected: message = "送回未受理，文字仍保留。"
        }
        if let operationID = activeOperationID {
            activeOperationID = nil
            recordResult(operationID, result: result, message: message)
            resultReceived?(operationID, result, message)
        }
        stateChanged?()
    }

    private func recordResult(_ operationID: String, result: DeliveryResult, message: String) {
        recentResults[operationID] = (result, message)
        resultOrder.append(operationID)
        if resultOrder.count > 128 { recentResults.removeValue(forKey: resultOrder.removeFirst()) }
        lastResult = ["operationID": operationID, "status": result.rawValue, "message": message]
    }
}
