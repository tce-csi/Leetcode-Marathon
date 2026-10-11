/**
 * Client-side copy of the contest service's public types. This file contains
 * type declarations only so the browser bundle never pulls in the server's
 * database layer.
 */
export interface ContestStatus {
  registration: "OPEN" | "SCHEDULED" | "CLOSED";
  contest: "SCHEDULED" | "LIVE" | "ENDED" | "UNAVAILABLE";
  canRegister: boolean;
  canParticipate: boolean;
  isLive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  timezone: string;
}
