import SwiftUI

@main
struct KartiseretApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            AppRootView(model: model)
        }
    }
}
