import Foundation

enum ReturnFieldPolicy {
    static let textRoles = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
    static func accepts(role: String, subrole: String?, enabled: Bool?, readOnly: Bool?,
                        valueSettable: Bool, selectedTextSettable: Bool, rangeSettable: Bool) -> Bool {
        guard textRoles.contains(role),
              subrole != "AXSecureTextField", enabled != false, readOnly != true else { return false }
        // Pasting does not require permission to replace the field's entire AXValue.
        return valueSettable || selectedTextSettable || rangeSettable
    }
}

struct ForegroundCaretCache<Snapshot> {
    private var processIdentifier: Int32?
    private var captured: Snapshot?

    mutating func record(processIdentifier: Int32, snapshot: Snapshot?) {
        self.processIdentifier = processIdentifier
        captured = snapshot
    }

    func resolve(processIdentifier: Int32, isForeground: Bool, fresh: Snapshot?) -> Snapshot? {
        if isForeground { return fresh }
        // Web editors can report nil or 0/0 after their application loses focus.
        if self.processIdentifier == processIdentifier { return captured }
        return nil
    }
}
