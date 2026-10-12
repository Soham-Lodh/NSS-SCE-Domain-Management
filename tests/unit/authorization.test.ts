import { describe, expect, it } from "vitest";
import {
  canAddTechTeam,
  canAssignDomainLead,
  canManageCoordinators,
  canManageRole,
  canOperateEvents,
  canRemoveTechTeam,
  canViewAllDomains,
  canViewAuditLogs,
  canViewTechTeamActivity,
  domainLeadDomainId,
  isSelf,
  primaryRole,
  wouldRemoveLastCoordinator,
} from "@/lib/authorization/roles";
import type { AppRole, RoleGrantView } from "@/lib/auth/types";

const grant = (role: AppRole, domainId: string | null = null): RoleGrantView => ({
  role,
  domainId,
  isActive: true,
});

describe("primary role precedence", () => {
  it("picks the highest-precedence active role", () => {
    expect(primaryRole([grant("VOLUNTEER"), grant("COORDINATOR")])).toBe("COORDINATOR");
    expect(primaryRole([grant("DOMAIN_LEAD", "d1"), grant("TECH_TEAM")])).toBe("TECH_TEAM");
    expect(primaryRole([grant("VOLUNTEER")])).toBe("VOLUNTEER");
  });

  it("ignores inactive grants", () => {
    expect(primaryRole([{ role: "COORDINATOR", domainId: null, isActive: false }, grant("VOLUNTEER")])).toBe(
      "VOLUNTEER",
    );
  });

  it("resolves the domain-lead domain", () => {
    expect(domainLeadDomainId([grant("DOMAIN_LEAD", "dom-1")])).toBe("dom-1");
    expect(domainLeadDomainId([grant("TECH_TEAM")])).toBeNull();
  });
});

describe("capability matrix", () => {
  it("only domain leads can operate events", () => {
    expect(canOperateEvents(["DOMAIN_LEAD"])).toBe(true);
    expect(canOperateEvents(["COORDINATOR"])).toBe(false);
    expect(canOperateEvents(["TECH_TEAM"])).toBe(false);
    expect(canOperateEvents(["VOLUNTEER"])).toBe(false);
  });

  it("only oversight roles can view all domains and audit logs", () => {
    expect(canViewAllDomains(["TECH_TEAM"])).toBe(true);
    expect(canViewAllDomains(["COORDINATOR"])).toBe(true);
    expect(canViewAllDomains(["DOMAIN_LEAD"])).toBe(false);
    expect(canViewAuditLogs(["TECH_TEAM"])).toBe(true);
    expect(canViewAuditLogs(["DOMAIN_LEAD"])).toBe(false);
    expect(canViewAuditLogs(["VOLUNTEER"])).toBe(false);
  });

  it("only coordinators can inspect tech-team activity", () => {
    expect(canViewTechTeamActivity(["COORDINATOR"])).toBe(true);
    expect(canViewTechTeamActivity(["TECH_TEAM"])).toBe(false);
  });

  it("oversight roles cannot mutate events or assignments", () => {
    for (const role of ["TECH_TEAM", "COORDINATOR", "VOLUNTEER"] as AppRole[]) {
      expect(canOperateEvents([role])).toBe(false);
    }
  });
});

describe("role-administration hierarchy", () => {
  it("tech team can add/remove tech team members", () => {
    expect(canManageRole(["TECH_TEAM"], "TECH_TEAM", "ADD")).toBe(true);
    expect(canManageRole(["TECH_TEAM"], "TECH_TEAM", "REMOVE")).toBe(true);
    expect(canAddTechTeam(["TECH_TEAM"])).toBe(true);
    expect(canRemoveTechTeam(["TECH_TEAM"])).toBe(true);
  });

  it("TECH TEAM CANNOT add, remove or demote a COORDINATOR", () => {
    expect(canManageRole(["TECH_TEAM"], "COORDINATOR", "ADD")).toBe(false);
    expect(canManageRole(["TECH_TEAM"], "COORDINATOR", "REMOVE")).toBe(false);
    expect(canManageCoordinators(["TECH_TEAM"])).toBe(false);
  });

  it("coordinators can manage coordinators and tech team", () => {
    expect(canManageRole(["COORDINATOR"], "COORDINATOR", "ADD")).toBe(true);
    expect(canManageRole(["COORDINATOR"], "COORDINATOR", "REMOVE")).toBe(true);
    expect(canManageRole(["COORDINATOR"], "TECH_TEAM", "ADD")).toBe(true);
  });

  it("both oversight roles can assign domain leads", () => {
    expect(canManageRole(["TECH_TEAM"], "DOMAIN_LEAD", "ADD")).toBe(true);
    expect(canManageRole(["COORDINATOR"], "DOMAIN_LEAD", "ADD")).toBe(true);
    expect(canAssignDomainLead(["TECH_TEAM"])).toBe(true);
    expect(canAssignDomainLead(["DOMAIN_LEAD"])).toBe(false);
  });

  it("domain leads and volunteers cannot manage platform roles", () => {
    expect(canManageRole(["DOMAIN_LEAD"], "TECH_TEAM", "ADD")).toBe(false);
    expect(canManageRole(["VOLUNTEER"], "DOMAIN_LEAD", "ADD")).toBe(false);
  });
});

describe("safety guards", () => {
  it("detects self role changes", () => {
    expect(isSelf("u1", "u1")).toBe(true);
    expect(isSelf("u1", "u2")).toBe(false);
  });

  it("protects the last active coordinator", () => {
    expect(wouldRemoveLastCoordinator(1, true)).toBe(true);
    expect(wouldRemoveLastCoordinator(2, true)).toBe(false);
    expect(wouldRemoveLastCoordinator(1, false)).toBe(false);
  });
});
