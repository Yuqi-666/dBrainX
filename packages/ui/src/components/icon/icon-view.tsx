// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { NodeIcon } from "@workspace/interfaces";
import { resolveFileUrl } from "@workspace/api-client";
import { cn } from "@workspace/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Lightbulb,
  Rocket,
  Star,
  Heart,
  Bookmark,
  Bell,
  Calendar,
  Clock,
  Camera,
  Video,
  Music,
  Headphones,
  Mic,
  Tv,
  Monitor,
  Smartphone,
  Laptop,
  Keyboard,
  Mouse,
  Database,
  Server,
  Cloud,
  CloudUpload,
  Download,
  Upload,
  Wifi,
  Battery,
  Zap,
  Flame,
  Droplet,
  Snowflake,
  Sun,
  Moon,
  Mountain,
  TreePine,
  Leaf,
  Bug,
  Fish,
  Cat,
  Dog,
  Apple,
  Pizza,
  Cake,
  Coffee,
  Utensils,
  ChefHat,
  Smile,
  Laugh,
  Frown,
  Angry,
  ThumbsUp,
  ThumbsDown,
  Hand,
  HandHeart,
  Handshake,
  User,
  Users,
  UserPlus,
  UserCheck,
  Baby,
  Accessibility,
  Eye,
  Brain,
  Stethoscope,
  Pill,
  Syringe,
  Activity,
  HeartPulse,
  Plane,
  Car,
  MapPin,
  Compass,
  Navigation,
  Route,
  Globe,
  Trophy,
  Target,
  Gamepad2,
  Palette,
  Paintbrush,
  PenTool,
  Pencil,
  Scissors,
  Ruler,
  ShoppingBag,
  ShoppingCart,
  Gift,
  PartyPopper,
  Sparkles,
  Check,
  X,
  Plus,
  Search,
  Settings,
  Wrench,
  Funnel,
  Tag,
  Lock,
  LockOpen,
  Key,
  Shield,
  ShieldCheck,
  Info,
  CircleAlert,
  TriangleAlert,
  CircleQuestionMark,
  CircleCheck,
  CircleX,
  Power,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  ChevronDown,
  Ellipsis,
  Menu,
  House,
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  Image,
  Package,
  Briefcase,
  Building2,
  Code,
  Terminal,
  Braces,
  Cpu,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Link,
  ExternalLink,
  Share2,
  Send,
  Mail,
  MessageSquare,
  MessageCircle,
  Phone,
  Calculator,
  Microscope,
  FlaskConical,
  Atom,
  Thermometer,
  Gauge,
  Recycle,
  Trash,
  Trash2,
  Coins,
  Banknote,
  CreditCard,
  TrendingUp,
  TrendingDown,
  ChartColumn,
  ChartPie,
  ChartLine,
  Table,
  LayoutGrid,
  LayoutDashboard,
  List,
  Building,
  GraduationCap,
  Wallet,
} from "lucide-react";

/** The box every resolved glyph draws in; `className` decides its size. */
const BOX =
  "inline-flex shrink-0 items-center justify-center overflow-hidden leading-none";

export interface IconViewProps {
  /** The node's icon; when absent the caller's `fallback` is drawn. */
  icon?: NodeIcon;
  /** Drawn when there is no icon, or the icon cannot be resolved. */
  fallback?: ReactNode;
  /** Sizing and rounding: 36px trigger button, 20px header, card corner. */
  className?: string;
  /**
   * Optional size for the Lucide glyph (`kind:"icon"`), **relative to
   * `className`'s box** — `size-3/5` in a `size-20` plate is a 48px glyph. Only
   * this branch needs it: an emoji is text (its size is the box's font-size) and
   * an image fills the box. Omitted ⇒ `size-4`, the small-box default.
   */
  glyphClassName?: string;
}

/** One entry of the curated icon library (sel §3.2 / §5 `图标` tab). */
export interface LucideIconEntry {
  /** The persisted `NodeIcon.value` for `kind:"icon"` — a Lucide name. */
  name: string;
  Icon: LucideIcon;
  /** Extra `Command` filter terms (semantic keywords, 中文别名). */
  keywords: string[];
}

/**
 * The P0 curated set: the common Lucide graphics, static imports only.
 *
 * Names are persisted, components are not — that is what keeps a stored icon
 * meaningful across `lucide-react` versions and lets the graph side reuse it one
 * day (sel §3.2). The full 1951-icon set (`lucide-react/dynamic`) is the P1
 * option; P0 stays offline and flicker-free.
 */
export const LUCIDE_ICON_ENTRIES: readonly LucideIconEntry[] = [
  {
    name: "Lightbulb",
    Icon: Lightbulb,
    keywords: ["light", "idea", "bulb", "inspiration", "tip"],
  },
  {
    name: "Rocket",
    Icon: Rocket,
    keywords: ["rocket", "launch", "startup", "ship", "space", "fast"],
  },
  {
    name: "Star",
    Icon: Star,
    keywords: ["star", "favorite", "rate", "bookmark", "important"],
  },
  {
    name: "Heart",
    Icon: Heart,
    keywords: ["heart", "love", "like", "favorite"],
  },
  {
    name: "Bookmark",
    Icon: Bookmark,
    keywords: ["bookmark", "save", "read", "later"],
  },
  {
    name: "Bell",
    Icon: Bell,
    keywords: ["bell", "notification", "alert", "ring"],
  },
  {
    name: "Calendar",
    Icon: Calendar,
    keywords: ["calendar", "date", "schedule", "event"],
  },
  {
    name: "Clock",
    Icon: Clock,
    keywords: ["clock", "time", "schedule"],
  },
  {
    name: "Camera",
    Icon: Camera,
    keywords: ["camera", "photo", "picture", "shoot"],
  },
  {
    name: "Video",
    Icon: Video,
    keywords: ["video", "movie", "film", "record"],
  },
  {
    name: "Music",
    Icon: Music,
    keywords: ["music", "note", "audio", "song"],
  },
  {
    name: "Headphones",
    Icon: Headphones,
    keywords: ["headphones", "audio", "listen"],
  },
  {
    name: "Mic",
    Icon: Mic,
    keywords: ["microphone", "record", "voice", "audio"],
  },
  {
    name: "Tv",
    Icon: Tv,
    keywords: ["tv", "television", "screen", "monitor"],
  },
  {
    name: "Monitor",
    Icon: Monitor,
    keywords: ["monitor", "screen", "display", "desktop"],
  },
  {
    name: "Smartphone",
    Icon: Smartphone,
    keywords: ["smartphone", "phone", "mobile", "device"],
  },
  {
    name: "Laptop",
    Icon: Laptop,
    keywords: ["laptop", "computer", "notebook"],
  },
  {
    name: "Keyboard",
    Icon: Keyboard,
    keywords: ["keyboard", "typing", "input", "keys"],
  },
  {
    name: "Mouse",
    Icon: Mouse,
    keywords: ["mouse", "click", "pointer"],
  },
  {
    name: "Database",
    Icon: Database,
    keywords: ["database", "sql", "storage", "table"],
  },
  {
    name: "Server",
    Icon: Server,
    keywords: ["server", "backend", "host", "rack"],
  },
  {
    name: "Cloud",
    Icon: Cloud,
    keywords: ["cloud", "storage", "weather"],
  },
  {
    name: "CloudUpload",
    Icon: CloudUpload,
    keywords: ["cloud-upload", "sync", "backup"],
  },
  {
    name: "Download",
    Icon: Download,
    keywords: ["download", "save", "export"],
  },
  {
    name: "Upload",
    Icon: Upload,
    keywords: ["upload", "import", "send"],
  },
  {
    name: "Wifi",
    Icon: Wifi,
    keywords: ["wifi", "network", "wireless", "signal"],
  },
  {
    name: "Battery",
    Icon: Battery,
    keywords: ["battery", "power", "charge"],
  },
  {
    name: "Zap",
    Icon: Zap,
    keywords: ["zap", "lightning", "fast", "energy", "bolt"],
  },
  {
    name: "Flame",
    Icon: Flame,
    keywords: ["flame", "fire", "hot", "trend"],
  },
  {
    name: "Droplet",
    Icon: Droplet,
    keywords: ["droplet", "water", "drop", "rain"],
  },
  {
    name: "Snowflake",
    Icon: Snowflake,
    keywords: ["snowflake", "snow", "cold", "winter"],
  },
  {
    name: "Sun",
    Icon: Sun,
    keywords: ["sun", "light", "day", "bright"],
  },
  {
    name: "Moon",
    Icon: Moon,
    keywords: ["moon", "night", "dark", "sleep"],
  },
  {
    name: "Mountain",
    Icon: Mountain,
    keywords: ["mountain", "peak", "hike", "nature"],
  },
  {
    name: "TreePine",
    Icon: TreePine,
    keywords: ["tree-pine", "tree", "forest", "nature"],
  },
  {
    name: "Leaf",
    Icon: Leaf,
    keywords: ["leaf", "plant", "eco", "nature", "green"],
  },
  {
    name: "Bug",
    Icon: Bug,
    keywords: ["bug", "insect", "debug", "issue"],
  },
  {
    name: "Fish",
    Icon: Fish,
    keywords: ["fish", "animal", "sea"],
  },
  {
    name: "Cat",
    Icon: Cat,
    keywords: ["cat", "animal", "pet"],
  },
  {
    name: "Dog",
    Icon: Dog,
    keywords: ["dog", "animal", "pet"],
  },
  {
    name: "Apple",
    Icon: Apple,
    keywords: ["apple", "fruit", "food"],
  },
  {
    name: "Pizza",
    Icon: Pizza,
    keywords: ["pizza", "food", "slice"],
  },
  {
    name: "Cake",
    Icon: Cake,
    keywords: ["cake", "dessert", "birthday"],
  },
  {
    name: "Coffee",
    Icon: Coffee,
    keywords: ["coffee", "drink", "cup", "cafe"],
  },
  {
    name: "Utensils",
    Icon: Utensils,
    keywords: ["utensils", "food", "eat", "restaurant"],
  },
  {
    name: "ChefHat",
    Icon: ChefHat,
    keywords: ["chef-hat", "cook", "kitchen"],
  },
  {
    name: "Smile",
    Icon: Smile,
    keywords: ["smile", "happy", "face", "emoji"],
  },
  {
    name: "Laugh",
    Icon: Laugh,
    keywords: ["laugh", "happy", "face", "emoji"],
  },
  {
    name: "Frown",
    Icon: Frown,
    keywords: ["frown", "sad", "face", "emoji"],
  },
  {
    name: "Angry",
    Icon: Angry,
    keywords: ["angry", "mad", "face", "emoji"],
  },
  {
    name: "ThumbsUp",
    Icon: ThumbsUp,
    keywords: ["thumbs-up", "like", "approve", "yes"],
  },
  {
    name: "ThumbsDown",
    Icon: ThumbsDown,
    keywords: ["thumbs-down", "dislike", "no"],
  },
  {
    name: "Hand",
    Icon: Hand,
    keywords: ["hand", "gesture", "stop"],
  },
  {
    name: "HandHeart",
    Icon: HandHeart,
    keywords: ["hand-heart", "care", "love"],
  },
  {
    name: "Handshake",
    Icon: Handshake,
    keywords: ["handshake", "deal", "agreement"],
  },
  {
    name: "User",
    Icon: User,
    keywords: ["user", "person", "account", "profile"],
  },
  {
    name: "Users",
    Icon: Users,
    keywords: ["users", "team", "people", "group"],
  },
  {
    name: "UserPlus",
    Icon: UserPlus,
    keywords: ["user-plus", "invite", "add", "member"],
  },
  {
    name: "UserCheck",
    Icon: UserCheck,
    keywords: ["user-check", "verified", "member"],
  },
  {
    name: "Baby",
    Icon: Baby,
    keywords: ["baby", "child", "person"],
  },
  {
    name: "Accessibility",
    Icon: Accessibility,
    keywords: ["accessibility", "a11y", "human"],
  },
  {
    name: "Eye",
    Icon: Eye,
    keywords: ["eye", "view", "visible", "watch"],
  },
  {
    name: "Brain",
    Icon: Brain,
    keywords: ["brain", "mind", "think", "smart"],
  },
  {
    name: "Stethoscope",
    Icon: Stethoscope,
    keywords: ["stethoscope", "doctor", "health"],
  },
  {
    name: "Pill",
    Icon: Pill,
    keywords: ["pill", "medicine", "drug"],
  },
  {
    name: "Syringe",
    Icon: Syringe,
    keywords: ["syringe", "vaccine", "injection"],
  },
  {
    name: "Activity",
    Icon: Activity,
    keywords: ["activity", "pulse", "health", "heartbeat"],
  },
  {
    name: "HeartPulse",
    Icon: HeartPulse,
    keywords: ["heart-pulse", "health", "cardio"],
  },
  {
    name: "Plane",
    Icon: Plane,
    keywords: ["plane", "flight", "travel", "fly"],
  },
  {
    name: "Car",
    Icon: Car,
    keywords: ["car", "auto", "vehicle", "drive"],
  },
  {
    name: "MapPin",
    Icon: MapPin,
    keywords: ["map-pin", "location", "place", "marker"],
  },
  {
    name: "Compass",
    Icon: Compass,
    keywords: ["compass", "navigate", "direction"],
  },
  {
    name: "Navigation",
    Icon: Navigation,
    keywords: ["navigation", "gps", "arrow"],
  },
  {
    name: "Route",
    Icon: Route,
    keywords: ["route", "path", "journey"],
  },
  {
    name: "Globe",
    Icon: Globe,
    keywords: ["globe", "world", "web", "internet"],
  },
  {
    name: "Trophy",
    Icon: Trophy,
    keywords: ["trophy", "award", "win", "prize"],
  },
  {
    name: "Target",
    Icon: Target,
    keywords: ["target", "goal", "aim", "focus"],
  },
  {
    name: "Gamepad2",
    Icon: Gamepad2,
    keywords: ["gamepad", "game", "play", "console"],
  },
  {
    name: "Palette",
    Icon: Palette,
    keywords: ["palette", "color", "design", "art"],
  },
  {
    name: "Paintbrush",
    Icon: Paintbrush,
    keywords: ["paintbrush", "art", "design"],
  },
  {
    name: "PenTool",
    Icon: PenTool,
    keywords: ["pen-tool", "design", "vector"],
  },
  {
    name: "Pencil",
    Icon: Pencil,
    keywords: ["pencil", "edit", "write", "draw"],
  },
  {
    name: "Scissors",
    Icon: Scissors,
    keywords: ["scissors", "cut", "tool"],
  },
  {
    name: "Ruler",
    Icon: Ruler,
    keywords: ["ruler", "measure", "tool"],
  },
  {
    name: "ShoppingBag",
    Icon: ShoppingBag,
    keywords: ["shopping-bag", "buy", "store"],
  },
  {
    name: "ShoppingCart",
    Icon: ShoppingCart,
    keywords: ["shopping-cart", "cart", "buy"],
  },
  {
    name: "Gift",
    Icon: Gift,
    keywords: ["gift", "present", "reward"],
  },
  {
    name: "PartyPopper",
    Icon: PartyPopper,
    keywords: ["party-popper", "celebrate"],
  },
  {
    name: "Sparkles",
    Icon: Sparkles,
    keywords: ["sparkles", "magic", "ai", "new"],
  },
  {
    name: "Check",
    Icon: Check,
    keywords: ["check", "done", "ok", "yes"],
  },
  {
    name: "X",
    Icon: X,
    keywords: ["x", "close", "cancel", "no"],
  },
  {
    name: "Plus",
    Icon: Plus,
    keywords: ["plus", "add", "new", "create"],
  },
  {
    name: "Search",
    Icon: Search,
    keywords: ["search", "find", "magnifier"],
  },
  {
    name: "Settings",
    Icon: Settings,
    keywords: ["settings", "gear", "config"],
  },
  {
    name: "Wrench",
    Icon: Wrench,
    keywords: ["wrench", "tool", "fix", "repair"],
  },
  {
    name: "Funnel",
    Icon: Funnel,
    keywords: ["filter", "funnel", "sort"],
  },
  {
    name: "Tag",
    Icon: Tag,
    keywords: ["tag", "label", "price"],
  },
  {
    name: "Lock",
    Icon: Lock,
    keywords: ["lock", "secure", "private"],
  },
  {
    name: "LockOpen",
    Icon: LockOpen,
    keywords: ["lock-open", "unlock", "public"],
  },
  {
    name: "Key",
    Icon: Key,
    keywords: ["key", "password", "access"],
  },
  {
    name: "Shield",
    Icon: Shield,
    keywords: ["shield", "security", "protect"],
  },
  {
    name: "ShieldCheck",
    Icon: ShieldCheck,
    keywords: ["shield-check", "secure", "verified"],
  },
  {
    name: "Info",
    Icon: Info,
    keywords: ["info", "about", "help"],
  },
  {
    name: "CircleAlert",
    Icon: CircleAlert,
    keywords: ["alert-circle", "warning", "error"],
  },
  {
    name: "TriangleAlert",
    Icon: TriangleAlert,
    keywords: ["alert-triangle", "warning", "danger"],
  },
  {
    name: "CircleQuestionMark",
    Icon: CircleQuestionMark,
    keywords: ["help-circle", "question", "faq"],
  },
  {
    name: "CircleCheck",
    Icon: CircleCheck,
    keywords: ["check-circle", "success", "done"],
  },
  {
    name: "CircleX",
    Icon: CircleX,
    keywords: ["x-circle", "error", "fail"],
  },
  {
    name: "Power",
    Icon: Power,
    keywords: ["power", "on", "off", "energy", "restart"],
  },
  {
    name: "RefreshCw",
    Icon: RefreshCw,
    keywords: ["refresh-cw", "reload", "sync"],
  },
  {
    name: "ArrowRight",
    Icon: ArrowRight,
    keywords: ["arrow-right", "next", "forward"],
  },
  {
    name: "ArrowLeft",
    Icon: ArrowLeft,
    keywords: ["arrow-left", "back", "previous"],
  },
  {
    name: "ArrowUp",
    Icon: ArrowUp,
    keywords: ["arrow-up", "top", "increase"],
  },
  {
    name: "ArrowDown",
    Icon: ArrowDown,
    keywords: ["arrow-down", "bottom", "decrease"],
  },
  {
    name: "ChevronRight",
    Icon: ChevronRight,
    keywords: ["chevron-right", "expand", "next"],
  },
  {
    name: "ChevronDown",
    Icon: ChevronDown,
    keywords: ["chevron-down", "expand", "dropdown"],
  },
  {
    name: "Ellipsis",
    Icon: Ellipsis,
    keywords: ["more-horizontal", "ellipsis", "menu"],
  },
  {
    name: "Menu",
    Icon: Menu,
    keywords: ["menu", "hamburger", "nav"],
  },
  {
    name: "House",
    Icon: House,
    keywords: ["home", "house", "start", "dashboard"],
  },
  {
    name: "Folder",
    Icon: Folder,
    keywords: ["folder", "directory", "group"],
  },
  {
    name: "FolderOpen",
    Icon: FolderOpen,
    keywords: ["folder-open", "directory", "open"],
  },
  {
    name: "File",
    Icon: File,
    keywords: ["file", "document", "page"],
  },
  {
    name: "FileText",
    Icon: FileText,
    keywords: ["file-text", "document", "text", "note"],
  },
  {
    name: "FileCode",
    Icon: FileCode,
    keywords: ["file-code", "source", "code", "script"],
  },
  {
    name: "Image",
    Icon: Image,
    keywords: ["image", "picture", "photo"],
  },
  {
    name: "Package",
    Icon: Package,
    keywords: ["package", "box", "shipping"],
  },
  {
    name: "Briefcase",
    Icon: Briefcase,
    keywords: ["briefcase", "work", "job", "business"],
  },
  {
    name: "Building2",
    Icon: Building2,
    keywords: ["building", "company", "office"],
  },
  {
    name: "Code",
    Icon: Code,
    keywords: ["code", "source", "developer"],
  },
  {
    name: "Terminal",
    Icon: Terminal,
    keywords: ["terminal", "console", "shell", "command"],
  },
  {
    name: "Braces",
    Icon: Braces,
    keywords: ["braces", "code", "json", "object"],
  },
  {
    name: "Cpu",
    Icon: Cpu,
    keywords: ["cpu", "processor", "chip", "hardware"],
  },
  {
    name: "GitBranch",
    Icon: GitBranch,
    keywords: ["git-branch", "version", "branch"],
  },
  {
    name: "GitCommitHorizontal",
    Icon: GitCommitHorizontal,
    keywords: ["git-commit", "version", "commit"],
  },
  {
    name: "GitMerge",
    Icon: GitMerge,
    keywords: ["git-merge", "version", "merge"],
  },
  {
    name: "GitPullRequest",
    Icon: GitPullRequest,
    keywords: ["git-pull-request", "pr", "review"],
  },
  {
    name: "Link",
    Icon: Link,
    keywords: ["link", "url", "chain"],
  },
  {
    name: "ExternalLink",
    Icon: ExternalLink,
    keywords: ["external-link", "open", "new", "tab"],
  },
  {
    name: "Share2",
    Icon: Share2,
    keywords: ["share", "social", "send"],
  },
  {
    name: "Send",
    Icon: Send,
    keywords: ["send", "submit", "message"],
  },
  {
    name: "Mail",
    Icon: Mail,
    keywords: ["mail", "email", "message"],
  },
  {
    name: "MessageSquare",
    Icon: MessageSquare,
    keywords: ["message-square", "chat", "comment"],
  },
  {
    name: "MessageCircle",
    Icon: MessageCircle,
    keywords: ["message-circle", "chat", "comment"],
  },
  {
    name: "Phone",
    Icon: Phone,
    keywords: ["phone", "call", "telephone"],
  },
  {
    name: "Calculator",
    Icon: Calculator,
    keywords: ["calculator", "math", "compute"],
  },
  {
    name: "Microscope",
    Icon: Microscope,
    keywords: ["microscope", "science", "lab"],
  },
  {
    name: "FlaskConical",
    Icon: FlaskConical,
    keywords: ["flask", "science", "lab", "chemistry"],
  },
  {
    name: "Atom",
    Icon: Atom,
    keywords: ["atom", "science", "physics"],
  },
  {
    name: "Thermometer",
    Icon: Thermometer,
    keywords: ["thermometer", "temperature", "weather"],
  },
  {
    name: "Gauge",
    Icon: Gauge,
    keywords: ["gauge", "speed", "meter", "dashboard"],
  },
  {
    name: "Recycle",
    Icon: Recycle,
    keywords: ["recycle", "eco", "reuse"],
  },
  {
    name: "Trash",
    Icon: Trash,
    keywords: ["trash", "delete", "bin"],
  },
  {
    name: "Trash2",
    Icon: Trash2,
    keywords: ["trash-2", "delete", "remove"],
  },
  {
    name: "Coins",
    Icon: Coins,
    keywords: ["coins", "money", "finance"],
  },
  {
    name: "Banknote",
    Icon: Banknote,
    keywords: ["banknote", "money", "cash"],
  },
  {
    name: "CreditCard",
    Icon: CreditCard,
    keywords: ["credit-card", "payment", "money"],
  },
  {
    name: "TrendingUp",
    Icon: TrendingUp,
    keywords: ["trending-up", "growth", "chart"],
  },
  {
    name: "TrendingDown",
    Icon: TrendingDown,
    keywords: ["trending-down", "decline", "chart"],
  },
  {
    name: "ChartColumn",
    Icon: ChartColumn,
    keywords: ["bar-chart", "analytics", "stats"],
  },
  {
    name: "ChartPie",
    Icon: ChartPie,
    keywords: ["pie-chart", "analytics", "stats"],
  },
  {
    name: "ChartLine",
    Icon: ChartLine,
    keywords: ["line-chart", "analytics", "stats"],
  },
  {
    name: "Table",
    Icon: Table,
    keywords: ["table", "grid", "data"],
  },
  {
    name: "LayoutGrid",
    Icon: LayoutGrid,
    keywords: ["layout-grid", "dashboard", "grid"],
  },
  {
    name: "LayoutDashboard",
    Icon: LayoutDashboard,
    keywords: ["layout-dashboard", "dashboard"],
  },
  {
    name: "List",
    Icon: List,
    keywords: ["list", "items", "menu"],
  },
  {
    name: "Building",
    Icon: Building,
    keywords: ["org", "company", "office"],
  },
  {
    name: "GraduationCap",
    Icon: GraduationCap,
    keywords: ["learn", "school", "graduate"],
  },
  {
    name: "Wallet",
    Icon: Wallet,
    keywords: ["money", "payment"],
  },
];

/** sel §3.2's literal shape: persisted {@link LucideIconEntry.name} → glyph. */
export const LUCIDE_ICON_SET: Record<string, LucideIcon> = Object.fromEntries(
  LUCIDE_ICON_ENTRIES.map((entry): [string, LucideIcon] => [
    entry.name,
    entry.Icon,
  ]),
);

/**
 * Names `lucide-react` itself renamed (0.5xx moved `AlertCircle` to
 * `CircleAlert` and friends). They are not in {@link LUCIDE_ICON_ENTRIES}, but a
 * row written by an older build — or by hand — still resolves instead of
 * dropping to `fallback`. Keyed by kebab-case; see {@link resolveLucideIcon}.
 */
const LUCIDE_ICON_ALIASES: Readonly<Record<string, string>> = {
  "alert-circle": "CircleAlert",
  "alert-octagon": "OctagonAlert",
  "alert-triangle": "TriangleAlert",
  "bar-chart-3": "ChartColumn",
  "check-circle": "CircleCheck",
  "check-circle-2": "CircleCheck",
  edit: "Pencil",
  filter: "Funnel",
  "globe-2": "Earth",
  "help-circle": "CircleQuestionMark",
  home: "House",
  "ice-cream": "IceCreamCone",
  "line-chart": "ChartLine",
  "more-horizontal": "Ellipsis",
  "more-vertical": "EllipsisVertical",
  "pie-chart": "ChartPie",
  unlock: "LockOpen",
  "x-circle": "CircleX",
};

/** `MessageSquare` → `message-square`, `Gamepad2` → `gamepad-2`. */
function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

const LUCIDE_ICON_INDEX: ReadonlyMap<string, LucideIcon> = new Map(
  LUCIDE_ICON_ENTRIES.map((entry): [string, LucideIcon] => [
    toKebabCase(entry.name),
    entry.Icon,
  ]),
);

/**
 * Resolves a persisted name to its glyph. `NodeIcon` allows both spellings
 * (kebab or Pascal, sel §0.2-3), and the renamed aliases above are folded in.
 * `undefined` means unknown, which the caller must render as `fallback` — never
 * as an error.
 */
export function resolveLucideIcon(name: string): LucideIcon | undefined {
  const kebab = toKebabCase(name.trim());
  const alias = LUCIDE_ICON_ALIASES[kebab];
  return LUCIDE_ICON_INDEX.get(alias ? toKebabCase(alias) : kebab);
}

export function IconView({
  icon,
  fallback,
  className,
  glyphClassName,
}: IconViewProps): ReactNode {
  if (!icon || !icon.value) return fallback ?? null;

  // Exhaustive over `NodeIcon["kind"]` with no `default` — the compiler is the
  // guard against a new kind quietly rendering nothing (plan §M2.1 row 1).
  switch (icon.kind) {
    case "image":
      return (
        <IconImage src={icon.value} fallback={fallback} className={className} />
      );

    case "emoji":
      // `color` is the 底色 behind the glyph (sel §0.2-3); the character itself
      // is never recoloured — an Emoji carries its own colours.
      return (
        <span
          className={cn(BOX, className)}
          style={icon.color ? { backgroundColor: icon.color } : undefined}
        >
          {icon.value}
        </span>
      );

    case "icon": {
      const Glyph = resolveLucideIcon(icon.value);
      // Unknown name → the type glyph, silently (sel §5: 查不到不抛错).
      if (!Glyph) return fallback ?? null;
      // For a Lucide glyph `color` is the stroke colour.
      return (
        <span
          className={cn(BOX, className)}
          style={icon.color ? { color: icon.color } : undefined}
        >
          <Glyph
            aria-hidden
            className={cn(
              "size-4 max-h-full max-w-full shrink-0",
              glyphClassName,
            )}
          />
        </span>
      );
    }
  }
}

/** The `kind:"image"` half — kept separate so a broken URL only resets itself. */
function IconImage({
  src,
  fallback,
  className,
}: {
  src: string;
  fallback?: ReactNode;
  className?: string;
}) {
  // Remember *which* src failed rather than a bare boolean: picking a new image
  // clears the fallback without an effect or a remount.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <>{fallback ?? null}</>;

  return (
    <span className={cn(BOX, className)}>
      <img
        src={resolveFileUrl(src)}
        alt=""
        draggable={false}
        onError={() => setFailedSrc(src)}
        className="size-full object-cover"
      />
    </span>
  );
}
