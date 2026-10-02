import Foundation

final class SettingsStore {
    let fileURL: URL
    private(set) var recoveryNotice: String?
    private var canSave = true

    init(directory: URL? = nil) {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("倚天26輸入便箋", isDirectory: true)
        fileURL = base.appendingPathComponent("settings.json")
    }

    func load() -> [String: Any] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [:] }
        guard let data = try? Data(contentsOf: fileURL), data.count <= 2_000_000,
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            let backup = fileURL.deletingLastPathComponent().appendingPathComponent("settings-damaged-" + UUID().uuidString + ".json")
            do {
                try FileManager.default.moveItem(at: fileURL, to: backup)
                recoveryNotice = "原設定檔無法讀取，已另存備份（settings-damaged-…json）。目前使用預設設定。"
            } catch {
                canSave = false
                recoveryNotice = "原設定檔無法讀取且無法備份，已保留原檔；暫不覆寫設定。"
            }
            return [:]
        }
        return value
    }

    func save(_ value: [String: Any]) throws {
        guard canSave else { throw CocoaError(.fileWriteNoPermission) }
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .prettyPrinted])
        guard data.count <= 2_000_000 else { throw CocoaError(.fileWriteOutOfSpace) }
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try data.write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
        recoveryNotice = nil
    }
}
