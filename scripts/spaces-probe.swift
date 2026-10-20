// Diagnostic for the tray panel on macOS: which Spaces does its window belong to?
//
//   swift scripts/spaces-probe.swift              # windows of "PR Radar" (the installed app)
//   swift scripts/spaces-probe.swift Electron     # windows of `npm run dev` (Electron's own binary)
//
// Prints the active Space, the Spaces of each display and, for every window of those processes,
// its level, whether it is on screen, the Spaces it belongs to and its window-server tags. A
// healthy panel lists every Space once it has been shown; one stuck on a single Space is the
// macOS 26/27 bug that window.ts works around with the transient behaviour (tags ending in 02;
// managed windows end in 01). Uses private SkyLight functions: diagnostics only, never part of the app.
import AppKit
import Foundation

typealias CGSConnectionID = UInt32
typealias CGSSpaceID = UInt64

let skyLight = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW)!
func symbol<T>(_ name: String, _ type: T.Type) -> T { unsafeBitCast(dlsym(skyLight, name), to: type) }
let CGSMainConnectionID = symbol("CGSMainConnectionID", (@convention(c) () -> CGSConnectionID).self)
let CGSGetActiveSpace = symbol("CGSGetActiveSpace", (@convention(c) (CGSConnectionID) -> CGSSpaceID).self)
let CGSSpaceGetType = symbol("CGSSpaceGetType", (@convention(c) (CGSConnectionID, CGSSpaceID) -> Int32).self)
let CGSCopyManagedDisplaySpaces = symbol("CGSCopyManagedDisplaySpaces", (@convention(c) (CGSConnectionID) -> Unmanaged<CFArray>?).self)
let CGSCopySpacesForWindows = symbol("CGSCopySpacesForWindows", (@convention(c) (CGSConnectionID, Int32, CFArray) -> Unmanaged<CFArray>?).self)
let CGSGetWindowTags = symbol("CGSGetWindowTags", (@convention(c) (CGSConnectionID, UInt32, UnsafeMutablePointer<Int32>, Int32) -> Int32).self)

let connection = CGSMainConnectionID()
let active = CGSGetActiveSpace(connection)
// Space types: 0 desktop, 4 another app's full-screen window.
print("active space: \(active) type \(CGSSpaceGetType(connection, active))")
if let displays = CGSCopyManagedDisplaySpaces(connection)?.takeRetainedValue() as? [[String: Any]] {
  for display in displays {
    let current = (display["Current Space"] as? [String: Any])?["ManagedSpaceID"] ?? "?"
    let spaces = (display["Spaces"] as? [[String: Any]])?.map { "\($0["ManagedSpaceID"] ?? 0):t\($0["type"] ?? 0)" } ?? []
    print("display \(display["Display Identifier"] ?? "?") current \(current) spaces \(spaces)")
  }
}

let owners = CommandLine.arguments.count > 1 ? Array(CommandLine.arguments.dropFirst()) : ["PR Radar"]
let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
for window in windows {
  guard let owner = window[kCGWindowOwnerName as String] as? String, owners.contains(where: { owner.hasPrefix($0) }) else { continue }
  let id = window[kCGWindowNumber as String] as? UInt32 ?? 0
  let layer = window[kCGWindowLayer as String] ?? "?"
  let onScreen = window[kCGWindowIsOnscreen as String] as? Bool ?? false
  let bounds = (window[kCGWindowBounds as String] as? [String: Any]).map { "\($0["X"] ?? 0),\($0["Y"] ?? 0) \($0["Width"] ?? 0)x\($0["Height"] ?? 0)" } ?? "?"
  var spaces: [CGSSpaceID] = []
  if let list = CGSCopySpacesForWindows(connection, 7, [id] as CFArray)?.takeRetainedValue() as? [CGSSpaceID] { spaces = list }
  var tags = [Int32](repeating: 0, count: 2)
  let tagError = CGSGetWindowTags(connection, id, &tags, 32)
  let tagText = tagError == 0 ? String(format: "%08x:%08x", UInt32(bitPattern: tags[0]), UInt32(bitPattern: tags[1])) : "error \(tagError)"
  print("window \(id) owner=\(owner) pid=\(window[kCGWindowOwnerPID as String] ?? 0) layer=\(layer) onscreen=\(onScreen) spaces=\(spaces) tags=\(tagText) bounds=\(bounds)")
}
