import ExpoModulesCore

public class CallScreenModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RiftnCallScreen")
    Events("onCallAction")

    Constant("supported") { true }

    AsyncFunction("getVoipToken") { () -> String? in
      CallCenter.shared.voipToken
    }.runOnQueue(.main)

    AsyncFunction("takePendingActions") { () -> [[String: String]] in
      CallCenter.shared.takePending()
    }.runOnQueue(.main)

    AsyncFunction("endCall") { (sessionId: String) in
      CallCenter.shared.end(sessionId: sessionId)
    }.runOnQueue(.main)

    AsyncFunction("completeMute") { (requestId: String, applied: Bool) in
      CallCenter.shared.completeMute(requestId, applied: applied)
    }.runOnQueue(.main)

    // Android only.
    AsyncFunction("requestUnlock") {}

    OnStartObserving {
      DispatchQueue.main.async {
        CallCenter.shared.onEvent = { [weak self] event in
          self?.sendEvent("onCallAction", event)
        }
      }
    }

    OnStopObserving {
      DispatchQueue.main.async {
        CallCenter.shared.onEvent = nil
      }
    }
  }
}
