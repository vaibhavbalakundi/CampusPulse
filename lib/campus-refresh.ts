export type CampusProfile = { id: string; role: string; active: boolean };
export type CampusView = { role: string; profileIds: readonly string[] };
export type CampusRefreshPlan = "commit" | "keep" | "replace" | "revoke";

function sameMembers(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const ordered = [...right].sort();
  return [...left].sort().every((id, index) => id === ordered[index]);
}

// A partial refresh must not pair a new directory with private records from the previous one.
export function campusRefreshPlan(previous: CampusView | null, nextProfiles: readonly CampusProfile[], userId: string, profileFailed: boolean, coreFailed: boolean): CampusRefreshPlan {
  if (profileFailed) return "revoke";
  const nextMe = nextProfiles.find(profile => profile.id === userId && profile.active);
  if (!nextMe) return "revoke";
  if (!coreFailed) return "commit";
  if (!previous || previous.role !== nextMe.role || !sameMembers(previous.profileIds, nextProfiles.map(profile => profile.id))) return "replace";
  return "keep";
}

export function campusViewFrom(profiles: readonly CampusProfile[], userId: string): CampusView | null {
  const me = profiles.find(profile => profile.id === userId && profile.active);
  return me ? { role: me.role, profileIds: profiles.map(profile => profile.id) } : null;
}
