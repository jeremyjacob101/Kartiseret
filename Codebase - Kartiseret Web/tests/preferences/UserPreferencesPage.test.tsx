import { useUserPreferencesStore } from "../../src/stores/userPreferencesStore";
import { UserPreferencesPage } from "../../src/components/UserPreferencesPage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("../../src/lib/authClient", () => ({
  getAuthClient: () => ({
    getSession: async () => ({ data: { user: null }, error: null }),
    listAccounts: async () => ({ data: [], error: null }),
    useSession: { subscribe: () => () => {} },
  }),
}));
vi.mock("../../src/components/maps/loadCityLocationPicker", () => ({
  loadCityLocationPicker: async () => ({ CityLocationPicker: () => null }),
}));
vi.mock("../../src/components/UserMovieDisplayPreferences", () => ({
  UserMovieDisplayPreferences: () => null,
}));
vi.mock("../../src/components/UserTicketAlerts", () => ({
  UserTicketAlerts: () => null,
}));
vi.mock("../../src/components/PasswordSecurityForm", () => ({
  PasswordSecurityForm: () => null,
}));
vi.mock("../../src/components/DeleteAccountSection", () => ({
  DeleteAccountSection: () => null,
}));

afterEach(() => {
  useUserPreferencesStore.setState(
    useUserPreferencesStore.getInitialState(),
    true,
  );
});

describe("UserPreferencesPage", () => {
  it("saves the preference to hide Re-Releases from the three listings", async () => {
    const user = userEvent.setup();
    const state = useUserPreferencesStore.getState();
    const saveHideReReleases = vi.fn(async (hide: boolean) => {
      useUserPreferencesStore.setState((current) => ({
        preferences: { ...current.preferences, hideReReleases: hide },
      }));
      return true;
    });
    useUserPreferencesStore.setState({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "qa@example.test",
      },
      preferences: { ...state.preferences, hideReReleases: false },
      syncing: false,
      saveHideReReleases,
    });

    render(
      <MemoryRouter>
        <UserPreferencesPage />
      </MemoryRouter>,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: /hide re-releases/i,
    });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);

    expect(saveHideReReleases).toHaveBeenCalledWith(true);
    expect(checkbox).toBeChecked();
  });

  it("saves default showtime filters and excluded cinemas", async () => {
    const user = userEvent.setup();
    const state = useUserPreferencesStore.getState();
    const saveShowtimePreferences = vi.fn(async (showtimePreferences) => {
      useUserPreferencesStore.setState((current) => ({
        preferences: { ...current.preferences, showtimePreferences },
      }));
      return true;
    });
    useUserPreferencesStore.setState({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "qa@example.test",
      },
      preferences: { ...state.preferences },
      loading: false,
      syncing: false,
      saveShowtimePreferences,
    });

    render(
      <MemoryRouter>
        <UserPreferencesPage />
      </MemoryRouter>,
    );

    const hebrew = screen.getByRole("checkbox", { name: "Hebrew" });
    expect(hebrew).toBeChecked();
    await user.click(hebrew);

    expect(saveShowtimePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        screeningFilters: expect.objectContaining({
          unchecked: expect.objectContaining({ dubLanguage: ["Hebrew"] }),
        }),
      }),
    );
    expect(hebrew).not.toBeChecked();

    const jerusalemCinema = screen.getByRole("checkbox", {
      name: "Cinema City Jerusalem",
    });
    await user.click(jerusalemCinema);
    expect(saveShowtimePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ excludedCinemaIds: ["aK90TvH244M7"] }),
    );
  });
});
