import Foundation

enum DeliveryMode: String {
    case copyReturn = "copy_return"
    case automatic = "auto_paste"
}

struct DeliveryDestination {
    let id: UUID
    let processIdentifier: Int32
    let name: String
    let hasCaret: Bool
}

enum DeliveryVerification { case pending, verified, unavailable }
enum DeliveryCaretRestoration { case pending, ready, unavailable }
enum DeliveryResult: Equatable {
    case copiedWithoutTarget, clipboardFailed, targetUnavailable, permissionRequired, caretUnavailable
    case activationFailed, focusChanged, returned, pasted, pasteUnavailable, pasteUnconfirmed
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
        if mode == .automatic {
            guard environment.automaticPasteAuthorized() else { completed(.permissionRequired); return }
            guard destination.hasCaret else { completed(.caretUnavailable); return }
        }
        operation = Operation(destination: destination, text: text, mode: mode, started: clock(), phase: .activating)
        guard environment.activate(destination) else { finish(.activationFailed); return }
        poll()
    }

    func activated(processIdentifier: Int32) {
        guard let operation else { return }
        if processIdentifier != operation.destination.processIdentifier && processIdentifier != environment.ownProcessIdentifier {
            finish(operation.phase == .verifying ? .pasteUnconfirmed : .focusChanged)
            return
        }
        poll()
    }

    func poll() {
        guard var active = operation else { return }
        guard environment.targetIsAlive(active.destination) else { finish(.targetUnavailable); return }
        if active.phase == .verifying {
            guard environment.foregroundProcessIdentifier() == active.destination.processIdentifier else { finish(.pasteUnconfirmed); return }
            switch environment.verifyPaste(active.destination) {
            case .verified: finish(.pasted)
            case .unavailable: finish(.pasteUnconfirmed)
            case .pending:
                if clock() - (active.pastedAt ?? active.started) >= 1.2 { finish(.pasteUnconfirmed) }
            }
            return
        }
        if active.phase == .activating && clock() - active.started >= 1.5 { finish(.activationFailed); return }
        guard let foreground = environment.foregroundProcessIdentifier() else { return }
        guard foreground == active.destination.processIdentifier else {
            if active.phase == .restoring || foreground != environment.ownProcessIdentifier { finish(.focusChanged) }
            return
        }
        if active.mode == .copyReturn { finish(.returned); return }
        guard environment.automaticPasteAuthorized() else { finish(.permissionRequired); return }
        if active.phase == .activating {
            active.phase = .restoring
            active.restoringAt = clock()
            operation = active
        }
        guard clock() - (active.restoringAt ?? active.started) < 1.5 else { finish(.caretUnavailable); return }
        switch environment.restoreCaret(active.destination, text: active.text) {
        case .unavailable: finish(.caretUnavailable); return
        case .pending:
            if clock() - (active.restoringAt ?? active.started) >= 1.5 { finish(.caretUnavailable) }
            return
        case .ready: break
        }
        guard environment.foregroundProcessIdentifier() == active.destination.processIdentifier else { finish(.focusChanged); return }
        // Set the phase before posting, so another activation callback cannot paste twice.
        active.phase = .verifying
        active.pastedAt = clock()
        operation = active
        guard environment.pasteOnce(active.destination) else { finish(.pasteUnavailable); return }
        // Native menu lookup may take time; allow a full verification window after posting.
        if operation?.destination.id == active.destination.id, operation?.phase == .verifying {
            operation?.pastedAt = clock()
        }
    }

    private func finish(_ result: DeliveryResult) {
        operation = nil
        completed(result)
    }
}
