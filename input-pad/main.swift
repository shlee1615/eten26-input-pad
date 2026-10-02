import AppKit
import WebKit

final class InputPadWindow: NSWindow {
    // Minimize as an ordinary window; the delegate restores the pinned level.
    override func miniaturize(_ sender: Any?) {
        level = .normal
        super.miniaturize(sender)
    }

    override func performMiniaturize(_ sender: Any?) {
        level = .normal
        super.performMiniaturize(sender)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var resources: URL!
    private var pinned = true
    private let pinnedPreferenceKey = "InputPadAlwaysOnTop"
    private var statusItem: NSStatusItem?
    private var statusMenu: NSMenu?
    private var pinMenuItem: NSMenuItem?
    private var settingsWindow: NSWindow?
    private var settingsWebView: WKWebView?
    private let settingsStore = SettingsStore()
    private var savedSettings: [String: Any] = [:]
    private let returnController = ReturnController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        resources = Bundle.main.resourceURL!
        pinned = (UserDefaults.standard.object(forKey: pinnedPreferenceKey) as? Bool) ?? true
        savedSettings = settingsStore.load()
        webView = makeWebView()
        window = InputPadWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 275),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "倚天26輸入便箋"
        window.minSize = NSSize(width: 430, height: 300)
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.hidesOnDeactivate = false
        window.level = pinned ? .floating : .normal
        if !window.setFrameUsingName("InputPadWindow") { window.center() }
        window.setFrameAutosaveName("InputPadWindow")
        installMenu()
        installStatusItem()
        returnController.stateChanged = { [weak self] in self?.syncDeliveryState() }
        returnController.resultReceived = { [weak self] result, message in
            guard let self else { return }
            let succeeded = result == .returned || result == .pasted
            if succeeded {
                self.applyPinnedLevel()
                // Keep the pad visible at its chosen level without taking keyboard
                // focus back from the original field. Returning must not hide it.
                if self.pinned && !self.window.isMiniaturized { self.window.orderFrontRegardless() }
            }
            let stillPinned = succeeded && self.pinned && self.window.isVisible && self.window.level == .floating
            let feedback = stillPinned ? message + " 便箋保持置頂。" : message
            self.webView.evaluateJavaScript("window.padHost?.deliveryResult(\(self.javascriptJSON(feedback)))")
        }
        returnController.start()
        webView.loadFileURL(resources.appendingPathComponent("index.html"), allowingReadAccessTo: resources)
        showWindow()
    }

    private func javascriptJSON(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        for name in ["copy", "pin", "settings", "saveSettings", "beep", "deliver", "deliveryMode", "requestAccessibility"] {
            configuration.userContentController.add(self, name: name)
        }
        configuration.userContentController.addUserScript(WKUserScript(
            source: "window.initialPadSettings = \(javascriptJSON(savedSettings)); window.settingsRecoveryNotice = \(javascriptJSON(settingsStore.recoveryNotice ?? "")); window.initialDeliveryState = \(javascriptJSON(returnController.state));",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        return view
    }

    private func installMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "倚天26輸入便箋")
        appMenu.addItem(withTitle: "關於倚天26輸入便箋", action: #selector(about), keyEquivalent: "")
        let settings = appMenu.addItem(withTitle: "設定…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        appMenu.addItem(withTitle: "隱藏倚天26輸入便箋", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "結束倚天26輸入便箋", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "編輯")
        for (title, selector, key) in [("復原", #selector(undoText), "z"), ("剪下", #selector(cutText), "x"), ("複製選取文字", #selector(copySelection), "c"), ("貼上", #selector(pasteText), "v"), ("全選", #selector(selectAllText), "a")] {
            let item = edit.addItem(withTitle: title, action: selector, keyEquivalent: key)
            item.target = self
        }
        let redo = edit.insertItem(withTitle: "重做", action: #selector(redoText), keyEquivalent: "z", at: 1)
        redo.keyEquivalentModifierMask = [.command, .shift]
        redo.target = self
        edit.addItem(.separator())
        let copy = edit.addItem(withTitle: "複製全部文字", action: #selector(copyAll), keyEquivalent: "\r")
        copy.target = self
        let deliver = edit.addItem(withTitle: "送回原程式", action: #selector(sendBack), keyEquivalent: "\r")
        deliver.keyEquivalentModifierMask = [.command, .shift]
        deliver.target = self
        editItem.submenu = edit
        menu.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "視窗")
        windowMenu.addItem(withTitle: "縮到 Dock", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "關閉視窗", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let show = windowMenu.addItem(withTitle: "顯示便箋", action: #selector(showWindow), keyEquivalent: "1")
        show.target = self
        windowItem.submenu = windowMenu
        menu.addItem(windowItem)
        NSApp.mainMenu = menu
        NSApp.windowsMenu = windowMenu
    }

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem = item
        if let button = item.button {
            let image = NSImage(systemSymbolName: "keyboard", accessibilityDescription: "倚天26輸入便箋")
            image?.isTemplate = true
            button.image = image
            button.toolTip = "倚天26輸入便箋：點一下顯示視窗；右鍵開啟選單"
            button.setAccessibilityLabel("倚天26輸入便箋")
            button.target = self
            button.action = #selector(statusItemClicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        let menu = NSMenu(title: "倚天26輸入便箋")
        let show = menu.addItem(withTitle: "顯示便箋", action: #selector(showWindow), keyEquivalent: "")
        show.target = self
        let pin = menu.addItem(withTitle: "視窗保持最上層", action: #selector(togglePinned), keyEquivalent: "")
        pin.target = self
        pin.state = pinned ? .on : .off
        pinMenuItem = pin
        let settings = menu.addItem(withTitle: "設定…", action: #selector(openSettings), keyEquivalent: "")
        settings.target = self
        menu.addItem(.separator())
        let quit = menu.addItem(withTitle: "結束倚天26輸入便箋", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        quit.target = NSApp
        statusMenu = menu
    }

    @objc private func statusItemClicked() {
        guard let button = statusItem?.button else { return }
        if NSApp.currentEvent?.type == .rightMouseUp {
            statusMenu?.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button)
        } else {
            showWindow()
        }
    }

    @objc private func togglePinned() { setPinned(!pinned) }

    private func setPinned(_ desired: Bool) {
        pinned = desired
        UserDefaults.standard.set(pinned, forKey: pinnedPreferenceKey)
        applyPinnedLevel()
        if pinned && window.isVisible && !window.isMiniaturized { window.orderFrontRegardless() }
        pinMenuItem?.state = pinned ? .on : .off
        syncPinnedButton()
    }

    private func applyPinnedLevel() {
        window.level = window.isMiniaturized ? .normal : (pinned ? .floating : .normal)
        settingsWindow?.level = pinned ? .floating : .normal
    }

    private func syncPinnedButton() {
        webView.evaluateJavaScript("window.padHost?.setPinned(\(pinned ? "true" : "false"))")
    }

    private func syncDeliveryState() {
        webView.evaluateJavaScript("window.padHost?.loadDelivery(\(javascriptJSON(returnController.state)))")
    }

    @objc private func sendBack() {
        guard NSApp.keyWindow === window else { return }
        webView.evaluateJavaScript("window.padHost?.sendBack()")
    }

    @objc private func about() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "倚天26輸入便箋",
            .applicationVersion: "1.3.3",
            .credits: NSAttributedString(string: "本機離線輸入便箋\n注音引擎：McBopomofoWeb 2.1.0\nCopyright © The McBopomofo Authors · MIT License\n按鍵解析與選字均在本機執行。"),
        ])
    }

    @objc private func copyAll() {
        guard NSApp.keyWindow === window else { return }
        webView.evaluateJavaScript("window.padHost?.copyAll()")
    }

    // Menu shortcuts may run before DOM keydown. Commit before forwarding editing actions.
    private func performEdit(_ selector: String) {
        if NSApp.keyWindow !== window {
            NSApp.sendAction(Selector(selector), to: nil, from: self)
            return
        }
        webView.evaluateJavaScript("window.padHost?.finish()") { [weak self] _, error in
            guard let self = self, error == nil, NSApp.keyWindow === self.window else { return }
            self.window.makeFirstResponder(self.webView)
            NSApp.sendAction(Selector(selector), to: nil, from: self)
        }
    }

    @objc private func cutText() { performEdit("cut:") }
    @objc private func copySelection() { performEdit("copy:") }
    @objc private func pasteText() { performEdit("paste:") }
    @objc private func selectAllText() { performEdit("selectAll:") }
    @objc private func undoText() {
        if NSApp.keyWindow === window { webView.evaluateJavaScript("window.padHost?.undo()") }
        else { NSApp.sendAction(NSSelectorFromString("undo:"), to: nil, from: self) }
    }
    @objc private func redoText() {
        if NSApp.keyWindow === window { webView.evaluateJavaScript("window.padHost?.redo()") }
        else { NSApp.sendAction(NSSelectorFromString("redo:"), to: nil, from: self) }
    }

    @objc private func openSettings() {
        webView.evaluateJavaScript("window.padHost?.finish()")
        if settingsWindow == nil {
            let view = makeWebView()
            let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 580, height: 650),
                                 styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            panel.title = "輸入設定"
            panel.minSize = NSSize(width: 500, height: 500)
            panel.contentView = view
            panel.isReleasedWhenClosed = false
            panel.delegate = self
            panel.center()
            settingsWindow = panel
            settingsWebView = view
            view.loadFileURL(resources.appendingPathComponent("settings.html"), allowingReadAccessTo: resources)
        } else {
            settingsWebView?.evaluateJavaScript("window.settingsHost?.load(\(javascriptJSON(savedSettings)))")
        }
        settingsWindow?.level = pinned ? .floating : .normal
        if settingsWindow?.isMiniaturized == true { settingsWindow?.deminiaturize(nil) }
        settingsWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func showWindow() {
        returnController.rememberOrigin()
        if window.isMiniaturized { window.deminiaturize(nil) }
        applyPinnedLevel()
        NSApp.unhide(nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(webView)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return false
    }

    func windowDidDeminiaturize(_ notification: Notification) {
        guard (notification.object as? NSWindow) === window else { return }
        applyPinnedLevel()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === settingsWindow { return true }
        // Keep the draft in memory; Dock or the menu-bar icon restores this pad.
        webView.evaluateJavaScript("window.padHost?.finish()")
        sender.orderOut(nil)
        return false
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let source = message.frameInfo.request.url,
              source.isFileURL, source.deletingLastPathComponent().standardizedFileURL == resources.standardizedFileURL else { return }
        if message.name == "copy", let text = message.body as? String {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            webView.evaluateJavaScript("window.padHost?.copied()")
        } else if message.name == "pin", let desired = message.body as? Bool {
            setPinned(desired)
        } else if message.name == "settings" {
            openSettings()
        } else if message.name == "deliver", message.webView === webView, let text = message.body as? String {
            returnController.send(text)
        } else if message.name == "deliveryMode", message.webView === webView, let value = message.body as? String {
            returnController.selectMode(value)
        } else if message.name == "requestAccessibility", message.webView === webView {
            returnController.requestAccessibility()
        } else if message.name == "beep" {
            NSSound.beep()
        } else if message.name == "saveSettings", let payload = message.body as? [String: Any],
                  let value = payload["value"] as? [String: Any] {
            do {
                try settingsStore.save(value)
                savedSettings = value
                let json = javascriptJSON(value)
                if message.webView === settingsWebView {
                    webView.evaluateJavaScript("window.padHost?.applySettings(\(json))")
                    settingsWebView?.evaluateJavaScript("window.settingsHost?.saved(\(json))")
                    if payload["closeAfter"] as? Bool == true { settingsWindow?.close(); showWindow() }
                } else {
                    webView.evaluateJavaScript("window.padHost?.settingsSaved()")
                    settingsWebView?.evaluateJavaScript("window.settingsHost?.load(\(json))")
                }
            } catch {
                if message.webView === settingsWebView {
                    settingsWebView?.evaluateJavaScript("window.settingsHost?.error('無法儲存設定，請重試。')")
                } else { webView.evaluateJavaScript("window.padHost?.settingsError()") }
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === self.webView { syncPinnedButton(); syncDeliveryState() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url,
              url.isFileURL,
              url.standardizedFileURL.path.hasPrefix(resources.standardizedFileURL.path + "/") else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
