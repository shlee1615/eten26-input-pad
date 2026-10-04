import Foundation

final class MockEnvironment: DeliveryEnvironment {
    let ownProcessIdentifier: Int32 = 1
    var foreground: Int32? = 1
    var alive = true, authorized = true, caretValid = true, pasteAvailable = true, clipboardWorks = true, activationWorks = true
    var verification: DeliveryVerification = .pending
    var copies = 0, activations = 0, restores = 0, pastes = 0
    var clipboard = "先前的剪貼簿"
    var onPaste: (() -> Void)?
    var restoration: DeliveryCaretRestoration = .ready
    func copyText(_ text: String) -> Bool { copies += 1; if clipboardWorks { clipboard = text }; return clipboardWorks }
    func targetIsAlive(_ destination: DeliveryDestination) -> Bool { alive }
    func automaticPasteAuthorized() -> Bool { authorized }
    var onActivate: (() -> Void)?
    func activate(_ destination: DeliveryDestination) -> Bool { activations += 1; onActivate?(); return activationWorks }
    func foregroundProcessIdentifier() -> Int32? { foreground }
    func restoreCaret(_ destination: DeliveryDestination, text: String) -> DeliveryCaretRestoration { restores += 1; return caretValid ? restoration : .unavailable }
    func pasteOnce(_ destination: DeliveryDestination) -> Bool { pastes += 1; onPaste?(); return pasteAvailable }
    func verifyPaste(_ destination: DeliveryDestination) -> DeliveryVerification { verification }
}

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
}
let destination = DeliveryDestination(id: UUID(), processIdentifier: 2, name: "Test Editor", hasCaret: true)
var count = 0
func scenario(_ body: (MockEnvironment, DeliveryFlow, () -> [DeliveryResult], (TimeInterval) -> Void) -> Void) {
    let environment = MockEnvironment()
    var results: [DeliveryResult] = []
    var time: TimeInterval = 0
    let flow = DeliveryFlow(environment: environment, clock: { time }, completed: { results.append($0) })
    body(environment, flow, { results }, { time = $0 })
    count += 1
}
scenario { env, flow, results, _ in
    env.authorized = false
    flow.begin(text: "你好", mode: .copyReturn, destination: destination)
    check(flow.isBusy && env.pastes == 0, "copy-return must wait for activation")
    env.foreground = 2; flow.activated(processIdentifier: 2)
    check(results() == [.returned] && env.restores == 0 && env.pastes == 0, "manual mode must work without AX")
}
scenario { env, flow, results, _ in
    flow.begin(text: "😀你好", mode: .automatic, destination: destination)
    flow.begin(text: "duplicate", mode: .automatic, destination: destination)
    check(env.copies == 1, "a busy send must not replace the clipboard")
    env.foreground = 2; flow.activated(processIdentifier: 2); flow.activated(processIdentifier: 2); flow.poll()
    check(env.pastes == 1, "repeated activation must post only one paste")
    env.verification = .verified; flow.poll()
    check(results() == [.pasted] && !flow.isBusy, "verified paste must complete")
}
scenario { env, flow, results, _ in
    env.authorized = false
    flow.begin(text: "你好", mode: .automatic, destination: destination)
    check(results() == [.permissionRequired] && env.activations == 0 && env.pastes == 0, "untrusted automatic mode must not operate another app")
}
scenario { env, flow, results, _ in
    flow.begin(text: "你好", mode: .automatic, destination: destination)
    env.foreground = 3; flow.activated(processIdentifier: 3)
    check(results() == [.focusChanged] && env.pastes == 0, "switching to an unexpected app must cancel before paste")
}
scenario { env, flow, results, advance in
    flow.begin(text: "你好", mode: .automatic, destination: destination)
    advance(2); flow.poll()
    check(results() == [.activationFailed] && env.pastes == 0, "activation timeout must not paste")
}
scenario { env, flow, results, _ in
    flow.begin(text: "你好", mode: .automatic, destination: destination)
    env.alive = false; flow.poll()
    check(results() == [.targetUnavailable] && env.pastes == 0, "an exited target must not receive text")
}
scenario { env, flow, results, _ in
    flow.begin(text: "你好", mode: .automatic, destination: destination)
    env.caretValid = false; env.foreground = 2; flow.poll()
    check(results() == [.caretUnavailable] && env.pastes == 0, "stale or changed caret must stop before paste")
}
scenario { env, flow, results, advance in
    flow.begin(text: "你好", mode: .automatic, destination: destination)
    env.foreground = 2; flow.poll(); advance(2); flow.poll(); flow.poll()
    check(results() == [.pasteUnconfirmed] && env.pastes == 1, "uncertain paste must not retry")
}
scenario { env, flow, results, _ in
    env.clipboardWorks = false
    flow.begin(text: "你好", mode: .copyReturn, destination: destination)
    check(results() == [.clipboardFailed] && env.activations == 0, "clipboard failure must leave focus alone")
    env.clipboardWorks = true
    flow.begin(text: "你好", mode: .copyReturn, destination: nil)
    check(results().last == .copiedWithoutTarget && !flow.isBusy, "copy remains available without a target")
}
scenario { env, flow, results, _ in
    flow.begin(text: "你好", mode: .automatic, destination: destination)
    env.authorized = false; env.foreground = 2; flow.poll()
    check(results() == [.permissionRequired] && env.pastes == 0, "permission revocation during activation must stop paste")
}
scenario { env, flow, results, advance in
    withoutActuallyEscaping(advance) { advanceTime in
        env.onPaste = { advanceTime(2) }
        flow.begin(text: "你好", mode: .automatic, destination: destination)
        env.foreground = 2; flow.poll(); flow.poll()
        check(flow.isBusy && results().isEmpty, "slow native lookup must not consume the verification window")
        advanceTime(2.5); env.verification = .verified; flow.poll()
        check(results() == [.pasted] && env.pastes == 1, "a delayed AX update should verify without another paste")
        env.onPaste = nil
    }
}
scenario { env, flow, results, _ in
    env.pasteAvailable = false
    flow.begin(text: "你好", mode: .automatic, destination: destination)
    env.foreground = 2; flow.poll(); flow.poll()
    check(results() == [.pasteUnavailable] && env.pastes == 1 && !flow.isBusy, "unavailable paste must finish and unlock without retry")
}
scenario { env, flow, results, advance in
    env.restoration = .pending
    flow.begin(text: "網頁測試", mode: .automatic, destination: destination)
    env.foreground = 2; flow.poll()
    check(flow.isBusy && env.pastes == 0, "web focus restoration must be allowed to finish asynchronously")
    advance(0.5); env.restoration = .ready; flow.poll()
    env.verification = .verified; flow.poll()
    check(results() == [.pasted] && env.pastes == 1, "asynchronous focus restore must paste exactly once")
}
scenario { env, flow, results, advance in
    env.restoration = .pending
    flow.begin(text: "網頁測試", mode: .automatic, destination: destination)
    env.foreground = 2; flow.poll(); advance(2); flow.poll()
    check(results() == [.caretUnavailable] && env.pastes == 0, "focus restoration timeout must not paste")
}
scenario { env, flow, results, _ in
    env.restoration = .pending
    flow.begin(text: "網頁測試", mode: .automatic, destination: destination)
    env.foreground = 2; flow.poll()
    env.foreground = 1; flow.poll()
    check(results() == [.focusChanged] && env.pastes == 0, "returning to the pad during focus restore must cancel")
}
for mode in [DeliveryMode.copyReturn, .automatic] {
    scenario { env, flow, results, _ in
        let draft = "不用先複製🙂"; var clipboardAtActivation = ""
        env.onActivate = { clipboardAtActivation = env.clipboard }
        flow.begin(text: draft, mode: mode, destination: destination)
        check(env.copies == 1 && clipboardAtActivation == draft, "return must replace the old clipboard before activating")
        env.foreground = 2; flow.poll()
        if mode == .automatic { env.verification = .verified; flow.poll() }
        check(results() == [mode == .automatic ? .pasted : .returned], "return must complete without a separate Copy action")
        check(env.clipboard == draft && env.pastes == (mode == .automatic ? 1 : 0), "manual and automatic must differ only in paste behavior")
        env.onActivate = nil
    }
}
for mode: DeliveryMode in [.automatic, .enterPaste] {
    scenario { env, flow, results, _ in
        env.authorized = false
        flow.begin(text: "第三模式", mode: mode, destination: destination)
        check(results() == [.permissionRequired] && env.pastes == 0 && env.activations == 0, "both automatic modes require explicit AX permission")
    }
    scenario { env, flow, results, advance in
        flow.begin(text: "第三模式", mode: mode, destination: destination)
        env.foreground = 2; flow.poll(); flow.poll()
        check(env.pastes == 1, "both automatic modes post exactly one paste")
        advance(2); flow.poll(); flow.poll()
        check(results() == [.pasteUnconfirmed] && env.pastes == 1 && !flow.isBusy, "uncertain paste must finish without a retry")
    }
    scenario { env, flow, results, _ in
        flow.begin(text: "第三模式", mode: mode, destination: destination)
        env.foreground = 2; flow.poll(); env.verification = .verified; flow.poll()
        check(results() == [.pasted] && env.pastes == 1, "both automatic modes verify the same way")
    }
}
scenario { env, flow, results, advance in
    env.restoration = .pending
    flow.begin(text: "lost foreground", mode: .enterPaste, destination: destination)
    env.foreground = 2; flow.poll()
    env.foreground = nil; advance(2); flow.poll()
    check(results() == [.caretUnavailable] && !flow.isBusy && env.pastes == 0, "restoration timeout must run even when foreground PID is unavailable")
}
scenario { env, flow, results, _ in
    env.activationWorks = false
    env.onActivate = { flow.activated(processIdentifier: 3) }
    flow.begin(text: "reentrant activation", mode: .enterPaste, destination: destination)
    check(results() == [.focusChanged] && !flow.isBusy, "failed activate returning after a callback cannot report a second terminal result")
    env.onActivate = nil
}
scenario { env, flow, results, _ in
    env.pasteAvailable = false
    env.onPaste = { flow.activated(processIdentifier: 3) }
    flow.begin(text: "reentrant paste", mode: .enterPaste, destination: destination)
    env.foreground = 2; flow.poll()
    check(results() == [.pasteUnconfirmed] && !flow.isBusy && env.pastes == 1, "failed paste returning after a callback cannot report a second terminal result")
    env.onPaste = nil
}
scenario { env, flow, results, _ in
    env.pasteAvailable = false
    env.onPaste = {
        env.onPaste = nil
        flow.activated(processIdentifier: 3)
        env.foreground = 1
        flow.begin(text: "next operation, same destination", mode: .enterPaste, destination: destination)
    }
    flow.begin(text: "old operation", mode: .enterPaste, destination: destination)
    env.foreground = 2; flow.poll()
    check(results() == [.pasteUnconfirmed] && flow.isBusy, "a returning old API failure cannot finish a newer operation with the same destination")
    env.pasteAvailable = true; env.foreground = 2; flow.poll(); env.verification = .verified; flow.poll()
    check(results() == [.pasteUnconfirmed, .pasted] && env.pastes == 2, "the new operation remains independent and posts exactly once")
}
print("Delivery flow: \(count) scenarios passed")
