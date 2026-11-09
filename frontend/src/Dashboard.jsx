import { useEffect, useRef, useState } from "react";

import HotelManagement from "./HotelManagement";
import RoomManagement from "./RoomManagement";
import ReservationManagement from "./ReservationManagement";
import StayManagement from "./StayManagement";
import HousekeepingManagement from "./HousekeepingManagement";
import StaffManagement from "./StaffManagement";
import MaintenanceManagement from "./MaintenanceManagement";
import GuestManagement from "./GuestManagement";
import GuestServices from "./GuestServices";
import BillingManagement from "./BillingManagement";
import FeedbackManagement from "./FeedbackManagement";
import NotificationManagement from "./NotificationManagement";
import ReportManagement from "./ReportManagement";
import SettingsManagement from "./SettingsManagement";

import "./admin.css";

const modules = [
  {
    id: "overview",
    label: "Dashboard",
    icon: "overview",
    group: "Overview",
  },
  {
    id: "hotels",
    label: "Hotels",
    icon: "hotel",
    group: "Property management",
    description: "Manage properties, hotel details and photographs.",
  },
  {
    id: "rooms",
    label: "Rooms",
    icon: "room",
    group: "Property management",
    description: "Room inventory, pricing and room status.",
  },
  {
    id: "reservations",
    label: "Reservations",
    icon: "calendar",
    group: "Guest experience",
    description: "Create bookings and manage reservations.",
  },
  {
    id: "checkin",
    label: "Check-in / Check-out",
    icon: "key",
    group: "Guest experience",
    description: "Manage arrivals, departures and current stays.",
  },
  {
    id: "guests",
    label: "Guests",
    icon: "users",
    group: "Guest experience",
    description: "Guest profiles, contact details and preferences.",
  },
  {
    id: "services",
    label: "Guest Services",
    icon: "service",
    group: "Guest experience",
    description: "Room service, transportation and guest requests.",
  },
  {
    id: "feedback",
    label: "Guest Feedback",
    icon: "star",
    group: "Guest experience",
    description: "Guest reviews, ratings and service feedback.",
  },
  {
    id: "housekeeping",
    label: "Housekeeping",
    icon: "clean",
    group: "Hotel operations",
    description: "Cleaning schedules and housekeeping tasks.",
  },
  {
    id: "maintenance",
    label: "Maintenance",
    icon: "tool",
    group: "Hotel operations",
    description: "Maintenance requests and resolution tracking.",
  },
  {
    id: "staff",
    label: "Staff & Roles",
    icon: "users",
    group: "Hotel operations",
    description: "Staff accounts, hotel assignments and permissions.",
  },
  {
    id: "billing",
    label: "Billing & Invoices",
    icon: "receipt",
    group: "Administration",
    description: "Create invoices, record payments and print bills.",
  },
  {
    id: "reports",
    label: "Reports & Analytics",
    icon: "chart",
    group: "Administration",
    description:
      "Current occupancy, reservation reports and booking amounts by currency.",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: "bell",
    group: "Administration",
    description: "Booking updates, maintenance alerts and staff notices.",
  },
  {
    id: "settings",
    label: "System Settings",
    icon: "settings",
    group: "Administration",
    description:
      "Configure hotel tax rates, timezones and check-in/check-out times.",
  },
];

const groups = [...new Set(modules.map((item) => item.group))];

const availableModules = new Set([
  "hotels",
  "rooms",
  "reservations",
  "checkin",
  "guests",
  "housekeeping",
  "staff",
  "maintenance",
  "services",
  "billing",
  "feedback",
  "notifications",
  "reports",
  "settings",
]);

const iconPaths = {
  overview:
    "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  hotel:
    "M5 21V3h14v18 M3 21h18 M9 7h1 M14 7h1 M9 11h1 M14 11h1 M10 21v-6h4v6",
  room:
    "M3 21V3h15v18 M1 21h21 M13 12h1",
  calendar:
    "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 18h2",
  key:
    "M14 4a6 6 0 1 1-4 10L3 21H1v-4l7-7a6 6 0 0 1 6-6 M15 8h.01",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-3.87",
  receipt:
    "M5 3h14v18l-3-2-4 2-4-2-3 2V3 M8 7h8 M8 11h8 M8 15h5",
  clean:
    "M15 3 9 14 M7 12l8 4-4 6-8-4z M6 17l4 2",
  tool:
    "M14 6a5 5 0 0 0-6 6L2 18l4 4 6-6a5 5 0 0 0 6-6l-3 3-4-4z",
  service:
    "M3 17h18 M5 17a7 7 0 0 1 14 0 M12 6v4 M10 6h4 M4 21h16",
  star:
    "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
  chart:
    "M3 3v18h18 M7 17v-5 M12 17V7 M17 17v-8",
  bell:
    "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  arrow:
    "M5 12h14 M13 6l6 6-6 6",
  logout:
    "M9 3H3v18h6 M10 12h11 M17 8l4 4-4 4",
  menu:
    "M3 6h18 M3 12h18 M3 18h18",
  close:
    "M6 6l12 12 M6 18 18 6",
  external:
    "M14 3h7v7 M21 3 10 14 M10 3H3v18h18v-7",
  refresh:
    "M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 2l1 4 M4 12l1 4a8 8 0 0 0 13 2",
};

function Icon({ name, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={iconPaths[name] || iconPaths.overview} />
    </svg>
  );
}

async function fetchCount(path, signal) {
  const response = await fetch(`/api/${path}?limit=1`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    throw new Error(
      response.status === 401
        ? "Your session has expired. Please sign out and log in again."
        : data?.message || `Unable to load ${path}.`
    );
  }

  if (
    !Number.isSafeInteger(data.pagination?.total) ||
    data.pagination.total < 0
  ) {
    throw new Error(`Invalid ${path} count received from the server.`);
  }

  return data.pagination.total;
}

export default function Dashboard({
  user,
  onLogout,
  loggingOut = false,
  logoutError = "",
}) {
  const [active, setActive] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);

  const [counts, setCounts] = useState({
    hotels: null,
    rooms: null,
    reservations: null,
  });

  const [loading, setLoading] = useState(true);
  const [countError, setCountError] = useState("");
  const [refresh, setRefresh] = useState(0);

  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);
  const mainRef = useRef(null);

  const currentModule =
    modules.find((item) => item.id === active) || modules[0];

  const firstName = user?.name?.trim().split(/\s+/)[0] || "Admin";

  const dateLabel = new Date().toLocaleDateString("en-PK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });

  useEffect(() => {
    document.title = `LuxuryStay | ${currentModule.label}`;
  }, [currentModule.label]);

  useEffect(() => {
    if (active !== "overview") return undefined;

    const controller = new AbortController();

    async function loadSummary() {
      setLoading(true);
      setCountError("");

      const paths = ["hotels", "rooms", "reservations"];

      const results = await Promise.allSettled(
        paths.map((path) => fetchCount(path, controller.signal))
      );

      if (controller.signal.aborted) return;

      const nextCounts = {};
      const errors = [];

      results.forEach((result, index) => {
        const path = paths[index];

        if (result.status === "fulfilled") {
          nextCounts[path] = result.value;
        } else {
          nextCounts[path] = null;
          errors.push(
            `${path}: ${result.reason?.message || "Unable to load count."}`
          );
        }
      });

      setCounts(nextCounts);
      setCountError(errors.join(" "));
      setLoading(false);
    }

    loadSummary();

    return () => controller.abort();
  }, [active, refresh]);

  // Close the mobile drawer when returning to desktop.
  useEffect(() => {
    const media = window.matchMedia("(min-width: 901px)");

    function handleResize() {
      if (media.matches) setMenuOpen(false);
    }

    media.addEventListener("change", handleResize);

    return () => media.removeEventListener("change", handleResize);
  }, []);

  // Mobile keyboard navigation and background scroll lock.
  useEffect(() => {
    if (!menuOpen) return undefined;

    const sidebar = sidebarRef.current;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const focusableSelector =
      'button:not([disabled]), a[href], [tabindex="0"]';

    sidebar?.querySelector(focusableSelector)?.focus();

    function handleKey(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !sidebar) return;

      const focusable = Array.from(
        sidebar.querySelectorAll(focusableSelector)
      ).filter((element) => element.getClientRects().length > 0);

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first) return;

      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !sidebar.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !sidebar.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }

  function navigate(id) {
    setActive(id);
    setMenuOpen(false);
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  const stats = [
    {
      id: "hotels",
      label: "Total hotels",
      icon: "hotel",
      note: "Properties registered in your system",
    },
    {
      id: "rooms",
      label: "Room inventory",
      icon: "room",
      note: "Rooms registered across all hotels",
    },
    {
      id: "reservations",
      label: "Total reservations",
      icon: "calendar",
      note: "All bookings, including cancelled reservations",
    },
  ];

  function renderModule() {
    switch (active) {
      case "hotels":
        return (
          <div className="ls-hotel-view">
            <HotelManagement
              user={user}
              onLogout={onLogout}
              loggingOut={loggingOut}
              logoutError=""
            />
          </div>
        );

      case "rooms":
        return <RoomManagement />;

      case "reservations":
        return <ReservationManagement />;

      case "checkin":
        return <StayManagement />;

      case "guests":
        return <GuestManagement />;

      case "housekeeping":
        return <HousekeepingManagement />;

      case "staff":
        return <StaffManagement />;

      case "maintenance":
        return <MaintenanceManagement />;

      case "services":
        return <GuestServices />;

      case "billing":
        return <BillingManagement />;

      case "feedback":
        return <FeedbackManagement />;

      case "notifications":
        return <NotificationManagement />;

      case "reports":
        return <ReportManagement />;

      case "settings":
        return <SettingsManagement />;

      default:
        return (
          <section className="ls-placeholder">
            <div className="ls-module-icon">
              <Icon name="overview" size={28} />
            </div>

            <h1>Page not found</h1>
            <p>Select a module from the navigation to continue.</p>

            <button
              type="button"
              className="ls-back"
              onClick={() => navigate("overview")}
            >
              Back to dashboard
              <Icon name="arrow" size={17} />
            </button>
          </section>
        );
    }
  }

  return (
    <div className="ls-shell">
      {menuOpen && (
        <button
          type="button"
          className="ls-backdrop"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={closeMenu}
        />
      )}

      <aside
        ref={sidebarRef}
        id="ls-navigation"
        className={`ls-sidebar ${menuOpen ? "open" : ""}`}
        aria-label="Administration navigation"
      >
        <button
          type="button"
          className="ls-mobile-close"
          onClick={closeMenu}
          aria-label="Close navigation"
        >
          <Icon name="close" size={18} />
          Close
        </button>

        <div className="ls-brand">
          <div className="ls-brand-mark" aria-hidden="true">
            L
          </div>
          <div>
            <strong>LuxuryStay</strong>
            <small>HOSPITALITY MANAGEMENT</small>
          </div>
        </div>

        <nav className="ls-nav" aria-label="Admin modules">
          {groups.map((group) => (
            <div className="ls-nav-group" key={group}>
              <span className="ls-nav-title">{group}</span>

              {modules
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`ls-nav-button ${
                      active === item.id ? "selected" : ""
                    }`}
                    aria-current={
                      active === item.id ? "page" : undefined
                    }
                    onClick={() => navigate(item.id)}
                  >
                    <Icon name={item.icon} size={18} />
                    <span>{item.label}</span>

                    {active === item.id && (
                      <span className="ls-nav-dot" aria-hidden="true" />
                    )}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <div className="ls-sidebar-bottom">
          <div className="ls-avatar" aria-hidden="true">
            {user?.name?.trim().charAt(0).toUpperCase() || "A"}
          </div>
          <div>
            <strong>{user?.name || "Admin"}</strong>
            <small>Administrator</small>
          </div>
        </div>
      </aside>

      <div className="ls-workspace">
        <header className="ls-topbar">
          <div className="ls-topbar-left">
            <button
              ref={menuButtonRef}
              type="button"
              className="ls-menu-toggle"
              aria-label="Open navigation"
              aria-controls="ls-navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <Icon name="menu" />
            </button>

            <div className="ls-breadcrumb">
              <span>ADMINISTRATION</span>
              <strong>{currentModule.label}</strong>
            </div>
          </div>

          <div className="ls-topbar-right">
            <a className="ls-public-link" href="#home">
              <Icon name="external" size={15} />
              <span>Public website</span>
            </a>

            <button
              type="button"
              className="ls-notification-button"
              aria-label="Open notifications"
              onClick={() => navigate("notifications")}
            >
              <Icon name="bell" size={19} />
            </button>

            <button
              type="button"
              className="ls-logout"
              onClick={onLogout}
              disabled={loggingOut}
            >
              <Icon name="logout" size={16} />
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </header>

        <main
          ref={mainRef}
          className="ls-content"
          id="admin-main"
          tabIndex={-1}
        >
          {logoutError && (
            <div className="ls-alert" role="alert">
              {logoutError}
            </div>
          )}

          {active === "overview" ? (
            <>
              <section className="ls-welcome">
                <div className="ls-welcome-copy">
                  <span className="ls-eyebrow">
                    YOUR HOSPITALITY WORKSPACE
                  </span>

                  <h1>
                    Welcome back, <em>{firstName}.</em>
                  </h1>

                  <p>
                    Thoughtful hospitality starts behind the scenes.
                    Manage your properties, people and guest experiences
                    from one place.
                  </p>

                  <div className="ls-welcome-actions">
                    <button
                      type="button"
                      className="ls-gold-button"
                      onClick={() => navigate("reservations")}
                    >
                      Manage reservations
                      <Icon name="arrow" size={17} />
                    </button>

                    <button
                      type="button"
                      className="ls-light-button"
                      onClick={() => navigate("checkin")}
                    >
                      Arrivals & departures
                    </button>
                  </div>

                  <span className="ls-date">
                    <Icon name="calendar" size={15} />
                    {dateLabel}
                  </span>
                </div>

                <div className="ls-welcome-art" aria-hidden="true">
                  <div className="ls-art-arch">
                    <span>L</span>
                    <small>LUXURYSTAY</small>
                  </div>
                </div>
              </section>

              <div className="ls-section-heading">
                <div>
                  <span className="ls-eyebrow">AT A GLANCE</span>
                  <h2>Your property portfolio</h2>
                </div>

                <button
                  type="button"
                  className="ls-refresh"
                  disabled={loading}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  <Icon name="refresh" size={16} />
                  {loading ? "Loading…" : "Refresh"}
                </button>
              </div>

              {countError && (
                <div className="ls-alert" role="alert">
                  {countError}
                </div>
              )}

              <section
                className="ls-stats"
                aria-label="Workspace summary"
                aria-busy={loading}
              >
                {stats.map((stat) => (
                  <article className="ls-stat" key={stat.id}>
                    <div className="ls-stat-top">
                      <span>{stat.label}</span>
                      <span className="ls-stat-icon">
                        <Icon name={stat.icon} size={21} />
                      </span>
                    </div>

                    <strong>
                      {loading
                        ? "…"
                        : counts[stat.id] == null
                          ? "—"
                          : counts[stat.id].toLocaleString("en-PK")}
                    </strong>

                    <small>{stat.note}</small>

                    <button
                      type="button"
                      className="ls-stat-link"
                      onClick={() => navigate(stat.id)}
                    >
                      View {stat.id}
                      <Icon name="arrow" size={15} />
                    </button>
                  </article>
                ))}
              </section>

              <div className="ls-section-heading">
                <div>
                  <span className="ls-eyebrow">
                    EVERY DETAIL, IN ONE PLACE
                  </span>
                  <h2>Manage your operations</h2>
                  <p>Select a module to open its workspace.</p>
                </div>

                <span className="ls-module-count">
                  {availableModules.size} modules available
                </span>
              </div>

              <section className="ls-module-grid" aria-label="Modules">
                {modules
                  .filter((item) => item.id !== "overview")
                  .map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className="ls-module-card"
                      onClick={() => navigate(item.id)}
                    >
                      <span className="ls-module-icon">
                        <Icon name={item.icon} size={23} />
                      </span>

                      <strong>{item.label}</strong>

                      <span className="ls-module-description">
                        {item.description}
                      </span>

                      <span className="ls-module-bottom">
                        <span
                          className={`ls-module-status ${
                            availableModules.has(item.id) ? "ready" : ""
                          }`}
                        >
                          {availableModules.has(item.id)
                            ? "Available"
                            : "Coming soon"}
                        </span>

                        <Icon name="arrow" size={17} />
                      </span>
                    </button>
                  ))}
              </section>
            </>
          ) : (
            <div className="ls-module-view">
              {renderModule()}
            </div>
          )}

          <footer className="ls-footer">
            <span>
              © {new Date().getFullYear()} LuxuryStay Hospitality
            </span>
            <span>Thoughtful service. Seamless operations.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}