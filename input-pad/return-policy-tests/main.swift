import Foundation

func check(_ value: @autoclosure () -> Bool, _ message: String) {
    if !value() { fatalError(message) }
}
check(ReturnFieldPolicy.accepts(role: "AXTextArea", subrole: nil, enabled: true, readOnly: false,
    valueSettable: false, selectedTextSettable: false, rangeSettable: true), "web text boxes with writable selection must support paste")
check(!ReturnFieldPolicy.accepts(role: "AXTextField", subrole: "AXSecureTextField", enabled: true, readOnly: false,
    valueSettable: true, selectedTextSettable: true, rangeSettable: true), "password fields must be excluded")
check(!ReturnFieldPolicy.accepts(role: "AXTextArea", subrole: nil, enabled: true, readOnly: true,
    valueSettable: false, selectedTextSettable: false, rangeSettable: true), "read-only text boxes must be excluded")
check(!ReturnFieldPolicy.accepts(role: "AXWebArea", subrole: nil, enabled: true, readOnly: nil,
    valueSettable: false, selectedTextSettable: false, rangeSettable: true), "a page-wide selection is not an editable field")
check(!ReturnFieldPolicy.accepts(role: "AXTextArea", subrole: nil, enabled: false, readOnly: false,
    valueSettable: true, selectedTextSettable: true, rangeSettable: true), "disabled text boxes must be excluded")
var cache = ForegroundCaretCache<NSRange>()
let captured = NSRange(location: 4, length: 2)
cache.record(processIdentifier: 20, snapshot: captured)
check(cache.resolve(processIdentifier: 20, isForeground: false, fresh: NSRange(location: 0, length: 0)) == captured,
    "losing DOM focus must not replace a known selection with Chromium's 0/0 fallback")
check(cache.resolve(processIdentifier: 20, isForeground: false, fresh: nil) == captured, "background nil must preserve the original caret")
check(cache.resolve(processIdentifier: 21, isForeground: false, fresh: nil) == nil, "a cached caret must never belong to another app")
check(cache.resolve(processIdentifier: 21, isForeground: false, fresh: NSRange(location: 0, length: 0)) == nil,
    "a first background read must not invent a caret at the start of a web field")
check(cache.resolve(processIdentifier: 20, isForeground: true, fresh: nil) == nil, "a current non-text focus must override an older caret")
cache.record(processIdentifier: 20, snapshot: nil)
check(cache.resolve(processIdentifier: 20, isForeground: false, fresh: nil) == nil, "leaving an editable field while foreground must clear it")
check(cache.resolve(processIdentifier: 20, isForeground: false, fresh: NSRange(location: 0, length: 0)) == nil,
    "a background placeholder must not revive a field after known non-text focus")
print("Return field policy and foreground cache: 12 checks passed")
