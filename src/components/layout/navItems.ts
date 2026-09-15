/*
 * Shared navigation model — the single source of truth for BOTH navigation
 * UIs: the desktop sidebar (Sidebar.tsx) and the Android island menu
 * (mobile/IslandMenu.tsx).
 */
import { LayoutDashboard, Home, User, Briefcase, Users, Receipt, Gift, Calculator, Gem, Flower, Activity, Award, Ticket, BarChart3, Sliders, Users as UsersIcon, FileText, Database, MessageCircle, Landmark } from "lucide-react";

export interface NavSection { sec: string }
export interface NavItem { id: string; to: string; icon: any; key: string }
export type NavEntry = NavItem | NavSection;

export function isSection(e: NavEntry): e is NavSection {
  return (e as NavSection).sec !== undefined;
}

export const NAV: NavEntry[] = [
  { id: "dash", to: "/", icon: LayoutDashboard, key: "nav_dashboard" },
  { sec: "Management" },
  { id: "families", to: "/families", icon: Home, key: "nav_families" },
  { id: "members", to: "/members", icon: User, key: "nav_members" },
  { id: "staff", to: "/staff", icon: Briefcase, key: "nav_staff" },
  { id: "committee", to: "/committee", icon: Users, key: "nav_committee" },
  { id: "subs", to: "/subscriptions", icon: Receipt, key: "nav_subscriptions" },
  { id: "dons", to: "/donations", icon: Gift, key: "nav_donations" },
  { id: "whatsapp", to: "/whatsapp", icon: MessageCircle, key: "nav_whatsapp" },
  { sec: "Finance" },
  { id: "acct", to: "/accounting", icon: Calculator, key: "nav_accounting" },
  { id: "assets", to: "/assets", icon: Landmark, key: "nav_assets" },
  { sec: "Registers" },
  { id: "marriage", to: "/marriages", icon: Gem, key: "nav_marriage" },
  { id: "death", to: "/deaths", icon: Flower, key: "nav_death" },
  { id: "welfare", to: "/welfare", icon: Activity, key: "nav_welfare" },
  { id: "certs", to: "/certificates", icon: Award, key: "nav_certificates" },
  { id: "tokens", to: "/tokens", icon: Ticket, key: "nav_tokens" },
  { sec: "System" },
  { id: "reports", to: "/reports", icon: BarChart3, key: "nav_reports" },
  { id: "settings", to: "/settings", icon: Sliders, key: "nav_settings" },
  { id: "users", to: "/users", icon: UsersIcon, key: "nav_users" },
  { id: "audit", to: "/audit", icon: FileText, key: "nav_audit" },
  { id: "backup", to: "/backup", icon: Database, key: "nav_backup" },
];

/** WhatsApp messaging is removed from the Android app. */
export const MOBILE_EXCLUDED_IDS = new Set(["whatsapp"]);

export const TINTS: Record<string, string> = {
  dash: "t-em", families: "t-em", members: "t-teal", staff: "t-vio", committee: "t-cyan",
  subs: "t-gold", dons: "t-pink", whatsapp: "t-teal", acct: "t-sky", assets: "t-teal",
  marriage: "t-vio", death: "t-slate", welfare: "t-orange", certs: "t-cyan", tokens: "t-pink",
  reports: "t-blue", settings: "t-vio", users: "t-blue", audit: "t-gold", backup: "t-teal",
};

export const SECTION_LABELS: Record<string, string> = {
  Management: "മാനേജ്മെന്റ്",
  Finance: "സാമ്പത്തികം",
  Registers: "രജിസ്റ്ററുകൾ",
  System: "സിസ്റ്റം",
};

export const PAGE_TITLE_KEYS: Record<string, string> = {
  "/": "nav_dashboard", "/families": "nav_families", "/members": "nav_members", "/staff": "nav_staff",
  "/committee": "nav_committee", "/subscriptions": "nav_subscriptions", "/donations": "nav_donations",
  "/whatsapp": "nav_whatsapp", "/accounting": "nav_accounting", "/assets": "nav_assets",
  "/marriages": "nav_marriage", "/deaths": "nav_death", "/welfare": "nav_welfare",
  "/certificates": "nav_certificates", "/tokens": "nav_tokens", "/tokens/manage": "nav_tokens",
  "/reports": "nav_reports", "/settings": "nav_settings", "/users": "nav_users",
  "/audit": "nav_audit", "/backup": "nav_backup",
};
