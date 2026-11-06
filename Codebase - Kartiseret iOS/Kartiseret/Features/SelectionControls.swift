import SwiftUI

private enum SelectionSheet: String, Identifiable {
    case city
    case day

    var id: String { rawValue }
}

struct SelectionControls: View {
    @Environment(AppStore.self) private var store
    @State private var sheet: SelectionSheet?

    var body: some View {
        HStack(spacing: 10) {
            Button { sheet = .city } label: {
                Label(store.selectedCity, systemImage: "mappin.and.ellipse")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.bordered)
            .tint(BrandStyle.accent)
            .accessibilityIdentifier("selectedCityButton")

            HStack(spacing: 4) {
                Button { store.moveDay(by: -1) } label: {
                    Image(systemName: "chevron.left")
                        .frame(width: 30, height: 36)
                }
                .disabled(store.selectedDay <= store.today)
                .accessibilityLabel("Previous day")
                .accessibilityIdentifier("day.previous")

                Button { sheet = .day } label: {
                    Text(store.selectedDay.displayName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(minWidth: 68)
                }
                .accessibilityIdentifier("selectedDayButton")

                Button { store.moveDay(by: 1) } label: {
                    Image(systemName: "chevron.right")
                        .frame(width: 30, height: 36)
                }
                .disabled(store.selectedDay >= store.lastSelectableDay)
                .accessibilityLabel("Next day")
                .accessibilityIdentifier("day.next")
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 4)
            .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 10))
        }
        .tint(.white)
        .sheet(item: $sheet) { destination in
            switch destination {
            case .city:
                CityPickerSheet()
            case .day:
                DayPickerSheet()
            }
        }
    }
}

private struct CityPickerSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if store.isLoadingCities && !store.citiesLoaded {
                    LoadingState(message: "Loading cities…")
                } else if store.cities.isEmpty, let error = store.cityError {
                    ErrorState(message: error) {
                        Task { await store.loadCities(forceRefresh: true) }
                    }
                    .padding()
                } else {
                    List {
                        if let cityError = store.cityError {
                            Section {
                                InlineError(message: cityError) {
                                    Task { await store.loadCities(forceRefresh: true) }
                                }
                                .listRowBackground(Color.clear)
                            }
                        }
                        ForEach(store.cities) { city in
                            Button {
                                store.selectCity(city.name)
                                dismiss()
                            } label: {
                                HStack {
                                    Text(city.name).foregroundStyle(.primary)
                                    Spacer()
                                    if city.name == store.selectedCity {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(BrandStyle.accent)
                                    }
                                }
                            }
                            .accessibilityIdentifier("city.\(city.name.lowercased().replacingOccurrences(of: " ", with: "-"))")
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Choose city")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task { await store.loadCities() }
    }
}

private struct DayPickerSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var selectedDate = Date.now

    private var selectableRange: ClosedRange<Date> {
        store.today.date...store.lastSelectableDay.date
    }

    var body: some View {
        NavigationStack {
            DatePicker(
                "Showtime day",
                selection: $selectedDate,
                in: selectableRange,
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .environment(\.calendar, CinemaDay.calendar)
            .environment(\.timeZone, CinemaDay.timeZone)
            .padding(.horizontal, 12)
            .accessibilityIdentifier("cinemaDayDatePicker")
            .navigationTitle("Choose day")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        if let day = CinemaDay(date: selectedDate) { store.selectDay(day) }
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { selectedDate = store.selectedDay.date }
    }
}
