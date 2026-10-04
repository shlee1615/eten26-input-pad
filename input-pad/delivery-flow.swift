import Foundation

enum DeliveryMode: String {
    case copyReturn = "copy_return"
    case automatic = "auto_paste"
    case enterPaste = "enter_paste"
    var requiresAutomaticPaste: Bool { self != .copyReturn }
}

struct DeliveryDestination {
    let id: UUID
    let processIdentifier: Int32
    let name: String
    let hasCaret: Bool
}

enum DeliveryVerification { case pending, verified, unavailable }
enum DeliveryCaretRestoration { case pending, ready, unavailable }
enum DeliveryResult: String, Equatable {
    case copiedWithoutTarget, clipboardFailed, targetUnavailable, permissionRequired, caretUnavailable
    case activationFailed, focusChanged, returned, pasted, pasteUnavailable, pasteUnconfirmed
    case rejected
}

protocol DeliveryEnvironment: AnyObject {
    var ownProcessIdentifier: Int32 { get }
    func copyText(_ text: String) -> Bool
    func targetIsAlive(_ destination: DeliveryDestination) -> Bool
    func automaticPasteAuthorized() -> Bool
    func activate(_ destination: DeliveryDestination) -> Bool
    func foregroundProcessIdentifier() -> Int32?
    func restoreCaret(_ destination: DeliveryDestination, text: String) -> DeliveryCaretRestoration
    func pasteOnce(_ destination: DeliveryDestination) -> Bool
    func verifyPaste(_ destination: DeliveryDestination) -> DeliveryVerification
}

// The flow owns exactly one paste attempt. Ambiguous results never trigger a retry.
final class DeliveryFlow {
    private enum Phase { case activating, restoring, verifying }
    private struct Operation {
        let id = UUID()
        let destination: DeliveryDestination
        let text: String
        let mode: DeliveryMode
        let started: TimeInterval
        var phase: Phase
        var pastedAt: TimeInterval?
        var restoringAt: TimeInterval?
    }
    private let environment: DeliveryEnvironment
    private let clock: () -> TimeInterval
    private let completed: (DeliveryResult) -> Void
    private var operation: Operation?
    var isBusy: Bool { operation != nil }

    init(environment: DeliveryEnvironment, clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         completed: @escaping (DeliveryResult) -> Void) {
        self.environment = environment
        self.clock = clock
        self.completed = completed
    }

    func begin(text: String, mode: DeliveryMode, destination: DeliveryDestination?) {
        guard operation == nil else { return }
        guard environment.copyText(text) else { completed(.clipboardFailed); return }
        guard let destination else { completed(.copiedWithoutTarget); return }
        guard environment.targetIsAlive(destination) else { completed(.targetUnavailable); return }
        if mode.requiresAutomaticPaste {
            guard environment.automaticPasteAuthorized() else { completed(.permissionRequired); return }
            guard destination.hasCaret else { completed(.caretUnavailable); return }
        }
        let active = Operation(destination: destination, text: text, mode: mode, started: clock(), phase: .activating)
        operation = active
        guard environment.activate(destination) else { finish(.activationFailed, for: active.id); return }
        poll()
    }

    func activated(processIdentifier: Int32) {
        guard let operation else { return }
        if processIdentifier != operation.destination.processIdentifier && processIdentifier != environment.ownProcessIdentifier {
            finish(operation.phase == .verifying ? .pasteUnconfirmed : .focusChanged, for: operation.id)
            return
        }
        poll()
    }

    func poll() {
        guard var active = operation else { return }
        guard environment.targetIsAlive(active.destination) else { finish(.targetUnavailable, for: active.id); return }
        if active.phase == .verifying {
            guard environment.foregroundProcessIdentifier() == active.destination.processIdentifier else { finish(.pasteUnconfirmed, for: active.id); return }
            switch environment.verifyPaste(active.destination) {
            case .verified: finish(.pasted, for: active.id)
            case .unavailable: finish(.pasteUnconfirmed, for: active.id)
            case .pending:
                if clock() - (active.pastedAt ?? active.started) >= 1.2 { finish(.pasteUnconfirmed, for: active.id) }
            }
            return
        }
        if active.phase == .activating && clock() - active.started >= 1.5 { finish(.activationFailed, for: active.id); return }
        if active.phase == .restoring && clock() - (active.restoringAt ?? active.started) >= 1.5 { finish(.caretUnavailable, for: active.id); return }
        guard let foreground = environment.foregroundProcessIdentifier() else { return }
        guard foreground == active.destination.processIdentifier else {
            if active.phase == .restoring || foreground != environment.ownProcessIdentifier { finish(.focusChanged, for: active.id) }
            return
        }
        if active.mode == .copyReturn { finish(.returned, for: active.id); return }
        guard environment.automaticPasteAuthorized() else { finish(.permissionRequired, for: active.id); return }
        if active.phase == .activating {
            active.phase = .restoring
            active.restoringAt = clock()
            operation = active
        }
        guard clock() - (active.restoringAt ?? active.started) < 1.5 else { finish(.caretUnavailable, for: active.id); return }
        let restoration = environment.restoreCaret(active.destination, text: active.text)
        guard operation?.id == active.id else { return }
        switch restoration {
        case .unavailable: finish(.caretUnavailable, for: active.id); return
        case .pending:
            if clock() - (active.restoringAt ?? active.started) >= 1.5 { finish(.caretUnavailable, for: active.id) }
            return
        case .ready: break
        }
        guard environment.foregroundProcessIdentifier() == active.destination.processIdentifier else { finish(.focusChanged, for: active.id); return }
        // Set the phase before posting, so another activation callback cannot paste twice.
        active.phase = .verifying
        active.pastedAt = clock()
        operation = active
        guard environment.pasteOnce(active.destination) else { finish(.pasteUnavailable, for: active.id); return }
        // Native menu lookup may take time; allow a full verification window after posting.
        if operation?.id == active.id, operation?.phase == .verifying {
            operation?.pastedAt = clock()
        }
    }

    private func finish(_ result: DeliveryResult, for operationID: UUID) {
        guard operation?.id == operationID else { return }
        operation = nil
        completed(result)
    }
}
