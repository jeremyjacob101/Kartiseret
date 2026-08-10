import Foundation
import Observation

@MainActor
@Observable
final class SessionStore {
    private(set) var session: UserSession?
    private(set) var isRestoring = true
    private(set) var isWorking = false
    var errorMessage: String?
    var confirmationMessage: String?

    @ObservationIgnored private let client: any AuthClient
    @ObservationIgnored private var observationTask: Task<Void, Never>?

    init(client: any AuthClient) {
        self.client = client
    }

    var isAuthenticated: Bool { session != nil }

    func start() {
        guard observationTask == nil else { return }
        observationTask = Task { [weak self] in
            guard let self else { return }
            session = await client.currentSession()
            isRestoring = false
            let stream = await client.sessionChanges()
            for await nextSession in stream {
                if Task.isCancelled { break }
                session = nextSession
                isRestoring = false
            }
        }
    }

    func signIn(email: String, password: String) async -> Bool {
        guard validate(email: email, password: password, creatingAccount: false) else { return false }
        isWorking = true
        errorMessage = nil
        confirmationMessage = nil
        defer { isWorking = false }
        do {
            session = try await client.signIn(email: email.normalizedEmail, password: password)
            return true
        } catch {
            errorMessage = Self.readable(error)
            return false
        }
    }

    func createAccount(email: String, password: String, city: String) async -> AuthSignUpResult? {
        guard validate(email: email, password: password, creatingAccount: true) else { return nil }
        isWorking = true
        errorMessage = nil
        confirmationMessage = nil
        defer { isWorking = false }
        do {
            let result = try await client.signUp(email: email.normalizedEmail, password: password, signupCity: city)
            if result.isSignedIn {
                session = result.user
            } else {
                confirmationMessage = "Check your inbox to confirm your email, then log in."
            }
            return result
        } catch {
            errorMessage = Self.readable(error)
            return nil
        }
    }

    func signOut() async -> Bool {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await client.signOut()
            session = nil
            return true
        } catch {
            errorMessage = Self.readable(error)
            return false
        }
    }

    func clearMessages() {
        errorMessage = nil
        confirmationMessage = nil
    }

    private func validate(email: String, password: String, creatingAccount: Bool) -> Bool {
        let email = email.normalizedEmail
        guard email.contains("@"), email.contains("."), !email.contains(" ") else {
            errorMessage = "Enter a valid email address."
            return false
        }
        let minimum = creatingAccount ? 8 : 1
        guard password.count >= minimum else {
            errorMessage = creatingAccount ? "Use at least 8 characters for your password." : "Enter your password."
            return false
        }
        return true
    }

    private static func readable(_ error: Error) -> String {
        let text = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "Something went wrong. Please try again." : text
    }
}

private extension String {
    var normalizedEmail: String {
        trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}
