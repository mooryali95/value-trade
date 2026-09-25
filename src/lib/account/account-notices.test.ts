import { describe, expect, it } from "vitest";
import { accountNotices } from "./account-notices";

const base = {
  email: "a@example.com",
  emailConfirmed: true,
  pendingInvitations: 0,
  onHold: false,
  isPlatformAdmin: false,
  isShariahReviewer: false,
  isTrader: false,
  companies: [] as Array<{ id: string; nameAr: string; nameEn: string; role: string }>,
  cashBalance: 0,
  pendingAccessRequest: null as { id: string; status: string; joinMethod: string } | null,
};

const ids = (s: Partial<typeof base>) => accountNotices({ ...base, ...s }).map((n) => n.id);

describe("accountNotices", () => {
  it("tells a new investor that trading is not activated yet", () => {
    expect(ids({})).toEqual(["activation"]);
    expect(accountNotices({ ...base, pendingAccessRequest: { id: "r", status: "pending", joinMethod: "investor" } })[0].key).toBe(
      "r_bannerRequestPending",
    );
  });

  it("an approved request waits for activation, it is not under review any more", () => {
    const n = accountNotices({ ...base, pendingAccessRequest: { id: "r", status: "approved", joinMethod: "investor" } });
    expect(n.map((x) => x.key)).toEqual(["r_bannerAwaitingActivation"]);
  });

  it("puts an unconfirmed address and pending invitations first", () => {
    expect(ids({ emailConfirmed: false, pendingInvitations: 2 })).toEqual(["email", "invitations", "activation"]);
    expect(accountNotices({ ...base, pendingInvitations: 1 }).find((n) => n.id === "invitations")?.key).toBe("r_bannerOneInvitation");
  });

  it("does not ask company staff or platform staff to get trading activated", () => {
    expect(ids({ companies: [{ id: "c", nameAr: "", nameEn: "", role: "finance" }] })).toEqual([]);
    expect(ids({ isPlatformAdmin: true })).toEqual([]);
    expect(ids({ isShariahReviewer: true })).toEqual([]);
  });

  it("explains an activated account without funds, and a review hold", () => {
    expect(ids({ isTrader: true })).toEqual(["funding"]);
    expect(ids({ isTrader: true, cashBalance: 1000 })).toEqual([]);
    expect(ids({ isTrader: true, onHold: true })).toEqual(["hold"]);
    expect(ids({ onHold: true })).toEqual(["hold"]);
  });
});
