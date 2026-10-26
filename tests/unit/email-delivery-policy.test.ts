import { describe, expect, it } from "vitest";
import { decideDelivery } from "@/lib/email/delivery-policy";

const now = new Date();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const scheduled = (startAt: Date, endAt: Date) =>
  ({ status: "SCHEDULED" as const, startAt, endAt });
const active = { status: "ASSIGNED" as const, removedAt: null };

describe("decideDelivery — assignment notices", () => {
  const start = new Date("2026-01-20T09:00:00Z");
  const end = new Date("2026-01-20T17:00:00Z");

  it("sends immediately — even before the event start date & time", () => {
    const d = decideDelivery({
      template: "EVENT_ASSIGNED",
      now: new Date(start.getTime() - 48 * HOUR),
      event: scheduled(start, end),
      assignment: active,
    });
    expect(d.action).toBe("send");
  });

  it("sends once the start date & time has arrived", () => {
    const d = decideDelivery({
      template: "EVENT_ASSIGNED",
      now: new Date(start.getTime() + 1000),
      event: scheduled(start, end),
      assignment: active,
    });
    expect(d.action).toBe("send");
  });

  it("never sends when the lead completed or ended the event first", () => {
    const d = decideDelivery({
      template: "EVENT_ASSIGNED",
      now: new Date(start.getTime() + HOUR),
      event: { status: "COMPLETED", startAt: start, endAt: end },
      assignment: active,
    });
    expect(d.action).toBe("suppress");
  });

  it("never sends when the lead removed the member first", () => {
    const d = decideDelivery({
      template: "EVENT_ASSIGNED",
      now: new Date(start.getTime() + HOUR),
      event: scheduled(start, end),
      assignment: { status: "ASSIGNED", removedAt: now },
    });
    expect(d.action).toBe("suppress");
  });
});

describe("decideDelivery — deadline reminders", () => {
  // Anchored relative to `now` so the tests never rot as wall-clock moves on.
  const end = new Date(now.getTime() + 2 * DAY);
  const start = new Date(end.getTime() - 8 * HOUR);

  it("sends the 4-day reminder inside its window", () => {
    const d = decideDelivery({
      template: "EVENT_REMINDER_4D",
      now,
      event: scheduled(start, end),
      assignment: active,
    });
    expect(d.action).toBe("send");
  });

  it("defers the 24-hour reminder until its window opens", () => {
    const d = decideDelivery({
      template: "EVENT_REMINDER_24H",
      now,
      event: scheduled(start, end),
      assignment: active,
    });
    expect(d.action).toBe("defer");
    if (d.action === "defer") expect(d.nextAttemptAt).toEqual(new Date(end.getTime() - DAY));
  });

  it("sends the 24-hour reminder once inside the window", () => {
    const d = decideDelivery({
      template: "EVENT_REMINDER_24H",
      now: new Date(end.getTime() - 23 * HOUR),
      event: scheduled(start, end),
      assignment: active,
    });
    expect(d.action).toBe("send");
  });

  it("suppresses the removed 1-hour reminder", () => {
    const d = decideDelivery({
      template: "EVENT_REMINDER_1H",
      now: new Date(end.getTime() - 30 * 60_000),
      event: scheduled(start, end),
      assignment: active,
    });
    expect(d.action).toBe("suppress");
  });

  it("does not defer the removed 1-hour reminder", () => {
    const d = decideDelivery({
      template: "EVENT_REMINDER_1H",
      now,
      event: scheduled(start, end),
      assignment: active,
    });
    expect(d.action).toBe("suppress");
  });

  it("re-defers when the deadline was pushed outside the window after queueing", () => {
    const later = new Date(end.getTime() + 10 * DAY);
    const d = decideDelivery({
      template: "EVENT_REMINDER_4D",
      now,
      event: scheduled(start, later),
      assignment: active,
    });
    expect(d.action).toBe("defer");
    if (d.action === "defer") expect(d.nextAttemptAt).toEqual(new Date(later.getTime() - 4 * DAY));
  });

  it("never sends when the lead completed or ended the event first", () => {
    for (const status of ["COMPLETED", "CANCELLED", "ARCHIVED"] as const) {
      const d = decideDelivery({
        template: "EVENT_REMINDER_4D",
        now,
        event: { status, startAt: start, endAt: end },
        assignment: active,
      });
      expect(d.action).toBe("suppress");
    }
  });

  it("never sends when the assignment was completed", () => {
    const d = decideDelivery({
      template: "EVENT_REMINDER_24H",
      now: new Date(end.getTime() - 23 * HOUR),
      event: scheduled(start, end),
      assignment: { status: "COMPLETED", removedAt: null },
    });
    expect(d.action).toBe("suppress");
  });

  it("never sends when the member was removed", () => {
    const d = decideDelivery({
      template: "EVENT_REMINDER_1H",
      now: new Date(end.getTime() - 30 * 60_000),
      event: scheduled(start, end),
      assignment: { status: "ASSIGNED", removedAt: now },
    });
    expect(d.action).toBe("suppress");
  });

  it("never sends once the deadline itself has passed", () => {
    const d = decideDelivery({
      template: "EVENT_REMINDER_4D",
      now: new Date(end.getTime() + HOUR),
      event: scheduled(start, end),
      assignment: active,
    });
    expect(d.action).toBe("suppress");
  });
});

describe("decideDelivery — completion and removal notices", () => {
  const start = new Date("2026-01-10T09:00:00Z");
  const end = new Date("2026-01-10T17:00:00Z");

  it("EVENT_COMPLETED is delivered even though the event status is COMPLETED", () => {
    const d = decideDelivery({
      template: "EVENT_COMPLETED",
      now,
      event: { status: "COMPLETED", startAt: start, endAt: end },
      assignment: { status: "COMPLETED", removedAt: null },
    });
    expect(d.action).toBe("send");
  });

  it("EVENT_COMPLETED is suppressed if the member was removed", () => {
    const d = decideDelivery({
      template: "EVENT_COMPLETED",
      now,
      event: { status: "COMPLETED", startAt: start, endAt: end },
      assignment: { status: "ASSIGNED", removedAt: now },
    });
    expect(d.action).toBe("suppress");
  });

  it("ASSIGNMENT_REMOVED reaches the member even though the assignment is removed", () => {
    const d = decideDelivery({
      template: "ASSIGNMENT_REMOVED",
      now,
      event: scheduled(start, end),
      assignment: { status: "ASSIGNED", removedAt: now },
    });
    expect(d.action).toBe("send");
  });
});

describe("decideDelivery — account notices and legacy rows", () => {
  it("role/account notices always send", () => {
    for (const template of ["ROLE_ASSIGNED", "DOMAIN_LEAD_ASSIGNED", "ACCOUNT_DEACTIVATED"] as const) {
      expect(decideDelivery({ template, now }).action).toBe("send");
    }
  });

  it("legacy rows without event/assignment references are sent (state unverifiable)", () => {
    const d = decideDelivery({ template: "EVENT_ASSIGNED", now });
    expect(d.action).toBe("send");
  });

  it("suppresses when the referenced event row is gone", () => {
    const d = decideDelivery({ template: "EVENT_ASSIGNED", now, event: null });
    expect(d.action).toBe("suppress");
  });
});
