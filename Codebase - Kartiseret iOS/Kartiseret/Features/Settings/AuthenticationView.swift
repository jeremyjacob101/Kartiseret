import SwiftUI

struct AuthenticationView: View {
    let initialMode: AuthMode
    @Environment(SessionStore.self) private var sessionStore
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(\.dismiss) private var dismiss
    @State private var mode: AuthMode
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focusedField: Field?

    enum Field { case email, password }

    init(initialMode: AuthMode) {
        self.initialMode = initialMode
        _mode = State(initialValue: initialMode)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 13) {
                        BrandMark(size: 62)
                        Text(mode == .logIn ? "Welcome back" : "Make Kartiseret yours")
                            .font(.title2.bold())
                        Text(mode == .logIn
                             ? "Sync your city, ratings, and accent color."
                             : "Create an account with email and password. Your guest city will come with you.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                            .multilineTextAlignment(.center)
                    }

                    Picker("Authentication mode", selection: $mode) {
                        ForEach(AuthMode.allCases) { value in Text(value.title).tag(value) }
                    }
                    .pickerStyle(.segmented)

                    VStack(spacing: 13) {
                        TextField("Email", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focusedField, equals: .email)
                            .submitLabel(.next)
                            .onSubmit { focusedField = .password }
                            .accessibilityIdentifier("auth.email")
                        Divider()
                        SecureField("Password", text: $password)
                            .textContentType(
                                AppConfiguration.isFixtureMode
                                    ? .oneTimeCode
                                    : (mode == .createAccount ? .newPassword : .password)
                            )
                            .focused($focusedField, equals: .password)
                            .submitLabel(.go)
                            .onSubmit { submit() }
                            .accessibilityIdentifier("auth.password")
                    }
                    .padding(16)
                    .background(Theme.raisedBackground, in: RoundedRectangle(cornerRadius: 15))
                    .overlay(RoundedRectangle(cornerRadius: 15).stroke(Theme.border))

                    if let message = sessionStore.errorMessage {
                        Label(message, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Theme.destructive)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if let message = sessionStore.confirmationMessage {
                        Label(message, systemImage: "envelope.badge.fill")
                            .font(.footnote)
                            .foregroundStyle(.green)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button(action: submit) {
                        Group {
                            if sessionStore.isWorking { ProgressView() }
                            else { Text(mode.actionTitle).fontWeight(.semibold) }
                        }
                        .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(sessionStore.isWorking)
                    .accessibilityIdentifier("auth.submit")

                    Text(mode == .createAccount
                         ? "By creating an account, you agree to use Kartiseret as-is. Password reset and account deletion are not available in this first release."
                         : "Kartiseret uses Supabase to securely manage email and password sessions.")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                        .multilineTextAlignment(.center)
                }
                .padding(24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle(mode.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onChange(of: mode) { _, _ in sessionStore.clearMessages() }
            .onAppear { focusedField = .email }
            .brandBackground()
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(sessionStore.isWorking)
    }

    private func submit() {
        guard !sessionStore.isWorking else { return }
        Task {
            switch mode {
            case .logIn:
                if await sessionStore.signIn(email: email, password: password) { dismiss() }
            case .createAccount:
                if let result = await sessionStore.createAccount(email: email, password: password, city: preferencesStore.city) {
                    await preferencesStore.initializeNewAccount(result)
                    if result.isSignedIn { dismiss() }
                }
            }
        }
    }
}
