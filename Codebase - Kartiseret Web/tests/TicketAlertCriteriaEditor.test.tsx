import { DEFAULT_TICKET_ALERT_CRITERIA, type TicketAlertCriteria } from "@kartiseret/contracts/private-data";
import { TicketAlertCriteriaEditor } from "../src/components/TicketAlertCriteriaEditor";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("TicketAlertCriteriaEditor", () => {
  it("saves account city selections and filter exclusions", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const value: TicketAlertCriteria = {
      cities: ["Jerusalem"],
      filters: {
        showType: ["Premium"],
        screenFormat: [],
        screeningTech: [],
        dubLanguage: [],
      },
    };
    render(
      <TicketAlertCriteriaEditor
        mode="defaults"
        value={value}
        defaults={value}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Haifa" }));
    await user.click(screen.getByRole("checkbox", { name: "Premium" }));
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(onSave).toHaveBeenCalledWith({
      cities: ["Jerusalem", "Haifa"],
      filters: {
        showType: [],
        screenFormat: [],
        screeningTech: [],
        dubLanguage: [],
      },
    });
  });

  it("stores only fields changed for a title so other fields inherit", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const defaults: TicketAlertCriteria = {
      cities: ["Haifa", "Jerusalem"],
      filters: {
        showType: ["Premium"],
        screenFormat: [],
        screeningTech: ["IMAX"],
        dubLanguage: [],
      },
    };
    render(
      <TicketAlertCriteriaEditor
        mode="title"
        value={{}}
        defaults={defaults}
        onSave={onSave}
      />,
    );

    const inheritToggles = screen.getAllByRole("checkbox", {
      name: "Use account default",
    });
    await user.click(inheritToggles[0]!);
    await user.click(screen.getByRole("checkbox", { name: "Haifa" }));
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(onSave).toHaveBeenCalledWith({ cities: ["Jerusalem"] });
    expect(DEFAULT_TICKET_ALERT_CRITERIA.cities).toBeNull();
  });
});
