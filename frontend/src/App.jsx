import { useEffect, useRef, useState } from "react";
import Dashboard from "./Dashboard";
import "./index.css";
import "./public.css";
import "./hero-video.css";

const WHATSAPP_NUMBER = "";

const WHATSAPP_MESSAGE =
  "Hello LuxuryStay! I would like information about rooms and reservations.";

const HERO_VIDEO = "/videos/hotel-hero.mp4";

const PHOTOS = {
  hero:
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1800&q=85",
  room:
    "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1000&q=80",
};

const PAGES = [
  "home",
  "hotels",
  "rooms",
  "about",
  "contact",
  "login",
  "register",
  "account",
  "bookings",
  "admin",
];

const ROOM_TYPES = [
  "standard",
  "deluxe",
  "executive",
  "suite",
  "presidential",
];

const EMPTY_ACCOUNT = {
  name: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

/* ==================== HELPERS ==================== */

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    const error = new Error(
      data?.message ||
        "Unable to complete the request. Please try again."
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

function money(amount, currency = "PKR") {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

function label(value = "") {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function readPage() {
  const current = window.location.hash.slice(1);
  return PAGES.includes(current) ? current : "home";
}

/* ==================== PAGINATION ==================== */

function Pager({ page, pages, disabled, onChange }) {
  if (pages <= 1) return null;

  return (
    <nav className="pub-pager" aria-label="Pagination">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ← Previous
      </button>

      <span>Page {page} of {pages}</span>

      <button
        type="button"
        disabled={disabled || page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next →
      </button>
    </nav>
  );
}

/* ==================== LOGO ==================== */

function Logo() {
  return (
    <a className="pub-logo" href="#home">
      <span className="pub-monogram" aria-hidden="true">L</span>
      <span>
        LuxuryStay
        <small>HOSPITALITY & RESIDENCES</small>
      </span>
    </a>
  );
}

/* ==================== WHATSAPP ==================== */

function WhatsAppButton() {
  const number = WHATSAPP_NUMBER.replace(/\D/g, "");
  const configured = /^[1-9]\d{7,14}$/.test(number);

  return (
    <a
      className="pub-whatsapp"
      href={
        configured
          ? `https://wa.me/${number}?text=${encodeURIComponent(
              WHATSAPP_MESSAGE
            )}`
          : "#contact"
      }
      target={configured ? "_blank" : undefined}
      rel={configured ? "noopener noreferrer" : undefined}
      aria-label={
        configured
          ? "Contact LuxuryStay on WhatsApp — opens in a new tab"
          : "View hotel contact details"
      }
    >
      <svg
        width="27"
        height="27"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M20.52 3.48A11.9 11.9 0 0 0 12.05 0C5.47 0 .12 5.35.12 11.93c0 2.1.55 4.16 1.59 5.98L.02 24l6.24-1.64a11.9 11.9 0 0 0 5.79 1.48h.01C18.63 23.84 24 18.49 24 11.91c0-3.18-1.24-6.17-3.48-8.43ZM12.06 21.82a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.7.97.99-3.61-.24-.37a9.87 9.87 0 0 1-1.52-5.29c0-5.47 4.45-9.92 9.92-9.92a9.86 9.86 0 0 1 7.02 2.91 9.85 9.85 0 0 1 2.9 7.02c0 5.47-4.45 9.92-9.96 9.92Zm5.44-7.43c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35Z" />
      </svg>

      <span>{configured ? "WhatsApp us" : "Contact us"}</span>
    </a>
  );
}

/* ==================== HERO VIDEO ==================== */

function HeroVideo() {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const preference = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    function applyPreference() {
      if (preference.matches) {
        video.pause();
        return;
      }

      if (!video.getAttribute("src")) {
        video.src = HERO_VIDEO;
      }

      video.muted = true;
      video.play().catch(() => {});
    }

    applyPreference();
    preference.addEventListener("change", applyPreference);

    return () => {
      preference.removeEventListener("change", applyPreference);
      video.pause();
    };
  }, []);

  async function toggleVideo() {
    const video = videoRef.current;
    if (!video || failed) return;

    if (!video.paused) {
      video.pause();
      return;
    }

    if (!video.getAttribute("src")) {
      video.src = HERO_VIDEO;
    }

    video.muted = true;

    try {
      await video.play();
    } catch {
      setPlaying(false);
    }
  }

  return (
    <>
      <img
        className="pub-hero-poster"
        src={PHOTOS.hero}
        alt=""
        fetchPriority="high"
        aria-hidden="true"
      />

      <video
        ref={videoRef}
        className={`pub-hero-video ${
          ready && !failed ? "is-ready" : ""
        }`}
        poster={PHOTOS.hero}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={() => {
          setReady(true);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onError={() => {
          setFailed(true);
          setPlaying(false);
        }}
      />


    </>
  );
}

/* ==================== SCROLL ANIMATIONS ==================== */

function usePublicAnimations(page, checking, role) {
  useEffect(() => {
    const root = document.querySelector(".pub");
    if (!root) return;

    const preference = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    const selector = [
      ".pub-heading",
      ".pub-card",
      ".pub-story",
      ".pub-strip",
      ".pub-search",
      ".pub-detail",
      ".pub-auth",
      ".pub-booking",
      ".pub-empty",
      ".pub-footer-grid > div",
    ].join(", ");

    const tracked = new Set();
    let observer;
    let mutations;

    function reveal(element) {
      element.classList.add("ls-visible");
      observer?.unobserve(element);
    }

    function prepare() {
      for (const element of tracked) {
        if (!root.contains(element)) {
          observer?.unobserve(element);
          tracked.delete(element);
        }
      }

      root.querySelectorAll(selector).forEach((element) => {
        if (tracked.has(element)) return;

        tracked.add(element);
        element.classList.add("ls-reveal");

        const parent = element.parentElement;

        if (parent?.matches(".pub-grid, .pub-footer-grid")) {
          const index = Array.from(parent.children).indexOf(element);

          element.style.setProperty(
            "--ls-reveal-delay",
            `${(Math.max(index, 0) % 3) * 75}ms`
          );
        }

        if (element.getBoundingClientRect().top < window.innerHeight) {
          reveal(element);
        } else {
          observer.observe(element);
        }
      });
    }

    function stop() {
      observer?.disconnect();
      mutations?.disconnect();
      root.classList.remove("ls-motion");

      tracked.forEach((element) => {
        element.classList.remove("ls-reveal", "ls-visible");
        element.style.removeProperty("--ls-reveal-delay");
      });

      tracked.clear();
    }

    function start() {
      stop();

      if (
        preference.matches ||
        !("IntersectionObserver" in window)
      ) {
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) reveal(entry.target);
          });
        },
        {
          threshold: 0,
          rootMargin: "0px 0px -35px 0px",
        }
      );

      root.classList.add("ls-motion");
      prepare();

      mutations = new MutationObserver(prepare);
      mutations.observe(root, {
        childList: true,
        subtree: true,
      });
    }

    function focus(event) {
      if (!(event.target instanceof Element)) return;
      const element = event.target.closest(".ls-reveal");
      if (element) reveal(element);
    }

    start();
    root.addEventListener("focusin", focus);
    preference.addEventListener("change", start);

    return () => {
      root.removeEventListener("focusin", focus);
      preference.removeEventListener("change", start);
      stop();
    };
  }, [page, checking, role]);
}

/* ==================== APPLICATION ==================== */

export default function App() {
  const [page, setPage] = useState(readPage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [account, setAccount] = useState({ ...EMPTY_ACCOUNT });
  const [showPassword, setShowPassword] = useState(false);

  const [hotels, setHotels] = useState([]);
  const [hotelPage, setHotelPage] = useState(1);
  const [hotelPages, setHotelPages] = useState(1);
  const [hotelLoading, setHotelLoading] = useState(true);
  const [hotelError, setHotelError] = useState("");
  const [hotelRefresh, setHotelRefresh] = useState(0);
  const [selectedHotel, setSelectedHotel] = useState(null);

  const [search, setSearch] = useState({
    checkInDate: dateAfter(1),
    checkOutDate: dateAfter(2),
    guests: "2",
    roomType: "",
  });

  const [searched, setSearched] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [roomPage, setRoomPage] = useState(1);
  const [roomPages, setRoomPages] = useState(1);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [roomRefresh, setRoomRefresh] = useState(0);
  const [selectedRoom, setSelectedRoom] = useState(null);

  const [bookingForm, setBookingForm] = useState({
    guestPhone: "",
    specialRequests: "",
  });

  const [bookings, setBookings] = useState([]);
  const [bookingPage, setBookingPage] = useState(1);
  const [bookingPages, setBookingPages] = useState(1);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingRefresh, setBookingRefresh] = useState(0);
  const [confirmation, setConfirmation] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  const actionLock = useRef(false);
  const pendingRequest = useRef(null);

  usePublicAnimations(page, checking, user?.role);

  /* NAVIGATION */

  function go(next) {
    setError("");
    setNotice("");
    setMenuOpen(false);

    if (window.location.hash === `#${next}`) {
      setPage(next);
    } else {
      window.location.hash = next;
    }

    window.scrollTo({ top: 0, behavior: "auto" });
  }

  useEffect(() => {
    function update() {
      setPage(readPage());
      setMenuOpen(false);
      setError("");
      setNotice("");
      window.scrollTo({ top: 0, behavior: "auto" });
    }

    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  useEffect(() => {
    if (page !== "admin") {
      document.title = `LuxuryStay | ${label(page)}`;
    }
  }, [page]);

  /* SESSION */

  useEffect(() => {
    const controller = new AbortController();

    api("/auth/me", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setUser(data.user);
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.status !== 401) {
          setError(
            "Unable to check your session. Please try signing in."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });

    return () => controller.abort();
  }, []);

  /* HOTELS */

  useEffect(() => {
    const controller = new AbortController();

    setHotelLoading(true);
    setHotelError("");

    api(`/public/hotels?page=${hotelPage}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setHotels(data.hotels);
        setHotelPages(data.pagination.pages);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setHotelError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setHotelLoading(false);
      });

    return () => controller.abort();
  }, [hotelPage, hotelRefresh]);

  /* ROOM SEARCH */

  useEffect(() => {
    if (!searched) {
      setRoomLoading(false);
      return;
    }

    const controller = new AbortController();

    setRoomLoading(true);
    setRoomError("");
    setRooms([]);

    const query = new URLSearchParams({
      ...searched,
      page: String(roomPage),
    });

    api(`/public/rooms?${query}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setRooms(data.rooms);
        setRoomPages(data.pagination.pages);
        setSelectedHotel(data.hotel);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setRoomError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRoomLoading(false);
      });

    return () => controller.abort();
  }, [searched, roomPage, roomRefresh]);

  /* BOOKINGS */

  useEffect(() => {
    if (page !== "bookings" || user?.role !== "guest") return;

    const controller = new AbortController();

    setBookingLoading(true);
    setBookingError("");
    setBookings([]);

    api(`/public/bookings?page=${bookingPage}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setBookings(data.bookings);
        setBookingPages(data.pagination.pages);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setBookingError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBookingLoading(false);
      });

    return () => controller.abort();
  }, [page, user, bookingPage, bookingRefresh]);

  /* SELECTION */

  function chooseHotel(hotel) {
    if (actionLock.current) return;

    setSelectedHotel(hotel);
    setSelectedRoom(null);
    setSearched(null);
    setRooms([]);
    setRoomError("");
    setConfirmation(null);
    pendingRequest.current = null;

    go("rooms");
  }

  function searchRooms(event) {
    event.preventDefault();

    if (!selectedHotel || actionLock.current) return;

    if (search.checkOutDate <= search.checkInDate) {
      setRoomError("Check-out must be after check-in.");
      return;
    }

    setError("");
    setSelectedRoom(null);
    setConfirmation(null);
    pendingRequest.current = null;
    setRoomPage(1);

    setSearched({
      ...search,
      hotel: selectedHotel._id,
    });

    setRoomRefresh((value) => value + 1);
  }

  function chooseRoom(room) {
    if (actionLock.current) return;

    pendingRequest.current = null;
    setSelectedRoom(room);
    setBookingForm({
      guestPhone: user?.phone || "",
      specialRequests: "",
    });
    setError("");
    setNotice("");
  }

  /* AUTHENTICATION */

  async function authenticate(event) {
    event.preventDefault();
    if (actionLock.current) return;

    setError("");
    const registering = page === "register";

    if (
      registering &&
      (account.password.length < 12 ||
        new TextEncoder().encode(account.password).length > 72)
    ) {
      setError(
        "Use at least 12 characters and no more than 72 bytes for your password."
      );
      return;
    }

    if (
      registering &&
      account.password !== account.confirmPassword
    ) {
      setError("Your passwords do not match.");
      return;
    }

    actionLock.current = true;
    setBusy(true);

    try {
      const payload = registering
        ? {
            name: account.name.trim(),
            email: account.email.trim(),
            phone: account.phone.trim(),
            password: account.password,
          }
        : {
            email: account.email.trim(),
            password: account.password,
          };

      const data = await api(
        registering ? "/auth/register" : "/auth/login",
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );

      setUser(data.user);
      setAccount({ ...EMPTY_ACCOUNT });
      setShowPassword(false);

      if (data.user.role === "admin") {
        go("admin");
      } else if (data.user.role === "guest" && selectedRoom) {
        setBookingForm((old) => ({
          ...old,
          guestPhone: old.guestPhone || data.user.phone || "",
        }));
        go("rooms");
      } else {
        go("account");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  async function logout() {
    if (actionLock.current) return;

    actionLock.current = true;
    setBusy(true);
    setError("");

    try {
      try {
        await api("/auth/logout", {
          method: "POST",
          body: "{}",
        });
      } catch (err) {
        if (err.status !== 401) throw err;
      }

      setUser(null);
      setBookings([]);
      setSelectedRoom(null);
      setConfirmation(null);
      setCancelTarget(null);
      pendingRequest.current = null;
      go("home");
    } catch (err) {
      setError(err.message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  /* CREATE RESERVATION */

  async function book(event) {
    event.preventDefault();

    if (actionLock.current || !selectedRoom || !searched) return;

    if (user?.role !== "guest") {
      setError("Please sign in with a guest account.");
      return;
    }

    setError("");
    setNotice("");

    if (!pendingRequest.current) {
      pendingRequest.current = {
        room: selectedRoom._id,
        checkInDate: searched.checkInDate,
        checkOutDate: searched.checkOutDate,
        numberOfGuests: Number(searched.guests),
        guestPhone: bookingForm.guestPhone.trim(),
        specialRequests: bookingForm.specialRequests.trim(),
        expectedTotalMinor: selectedRoom.quote.totalMinor,
        expectedCurrency: selectedRoom.quote.currency,
        requestKey: crypto.randomUUID(),
      };
    }

    actionLock.current = true;
    setBusy(true);

    try {
      const data = await api("/public/bookings", {
        method: "POST",
        body: JSON.stringify(pendingRequest.current),
      });

      pendingRequest.current = null;
      setConfirmation(data.booking);
      setSelectedRoom(null);
      setRooms([]);
      setSearched(null);
      setBookingRefresh((value) => value + 1);
      setNotice(data.message);
    } catch (err) {
      if (err.status >= 400 && err.status < 500) {
        pendingRequest.current = null;
      }

      setError(
        err.status
          ? err.message
          : "Connection interrupted. Retry confirmation using this same form, or check My Bookings."
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  /* CANCEL RESERVATION */

  async function cancelBooking(event) {
    event.preventDefault();
    if (!cancelTarget || actionLock.current) return;

    actionLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const data = await api(
        `/public/bookings/${cancelTarget._id}/cancel`,
        {
          method: "PATCH",
          body: JSON.stringify({ reason: cancelReason }),
        }
      );

      setCancelTarget(null);
      setCancelReason("");
      setNotice(data.message);
      setBookingRefresh((value) => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  /* HOTEL CATALOGUE */

  function hotelCatalogue(contact = false) {
    return (
      <>
        {hotelLoading ? (
          <div className="pub-empty" role="status">
            Loading our hotel collection…
          </div>
        ) : hotelError ? (
          <div className="pub-alert" role="alert">
            {hotelError}
            <div className="pub-actions">
              <button
                type="button"
                onClick={() => setHotelRefresh((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          </div>
        ) : hotels.length === 0 ? (
          <div className="pub-empty">
            Our hotel collection will appear here once properties
            are available.
          </div>
        ) : (
          <div className="pub-grid">
            {hotels.map((hotel) => (
              <article className="pub-card" key={hotel._id}>
                {!contact && (
                  <div className="pub-image-wrap">
                    <img
                      className="pub-card-img"
                      src={PHOTOS.hero}
                      alt="Illustrative hotel exterior"
                      loading="lazy"
                    />
                    <span className="pub-image-note">
                      Illustrative photo
                    </span>
                  </div>
                )}

                <div className="pub-card-body">
                  <span className="pub-location">
                    {hotel.city} · {hotel.country}
                  </span>

                  <h3>{hotel.name}</h3>

                  <p className="pub-muted">
                    {hotel.description || hotel.address}
                  </p>

                  {contact ? (
                    <div className="pub-contact">
                      <p>{hotel.address}</p>
                      {hotel.phone && <p>Phone: {hotel.phone}</p>}
                      {hotel.email && (
                        <p>
                          <a href={`mailto:${hotel.email}`}>
                            {hotel.email}
                          </a>
                        </p>
                      )}
                      {!hotel.phone && !hotel.email && (
                        <p>
                          Contact details have not been published yet.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="pub-card-meta">
                      <span>
                        Arrival <strong>{hotel.checkInTime}</strong>
                      </span>
                      <span>
                        Departure <strong>{hotel.checkOutTime}</strong>
                      </span>
                    </div>
                  )}

                  <button
                    type="button"
                    className="pub-primary"
                    disabled={busy}
                    onClick={() => chooseHotel(hotel)}
                  >
                    View rooms & book
                    <span aria-hidden="true">↗</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        <Pager
          page={hotelPage}
          pages={hotelPages}
          disabled={hotelLoading || busy}
          onChange={setHotelPage}
        />
      </>
    );
  }

  /* ADMIN */

  if (!checking && user?.role === "admin" && page === "admin") {
    return (
      <>
        <button
          type="button"
          className="ls-public-return"
          onClick={() => go("home")}
        >
          Public website ↗
        </button>

        <Dashboard
          user={user}
          onLogout={logout}
          loggingOut={busy}
          logoutError={error}
        />
      </>
    );
  }

  /* PUBLIC WEBSITE */

  return (
    <div className="pub">
      <a
        className="pub-skip"
        href="#public-main"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById("public-main");
          main?.focus({ preventScroll: true });
          main?.scrollIntoView({ block: "start" });
        }}
      >
        Skip to content
      </a>

      <div className="pub-topline">
        <div>
          <span>THOUGHTFUL SPACES. MEMORABLE STAYS.</span>
          <a href="#contact">Speak to your hotel ↗</a>
        </div>
      </div>

      <header className="pub-header">
        <nav className="pub-nav" aria-label="Main navigation">
          <Logo />

          <button
            type="button"
            className="pub-menu"
            aria-expanded={menuOpen}
            aria-controls="public-navigation"
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? "Close ✕" : "Menu ☰"}
          </button>

          <div
            id="public-navigation"
            className={`pub-links ${menuOpen ? "is-open" : ""}`}
          >
            {["home", "hotels", "about", "contact"].map((item) => (
              <a
                key={item}
                href={`#${item}`}
                aria-current={page === item ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {item === "hotels" ? "Our Hotels" : label(item)}
              </a>
            ))}

            <a
              className="pub-btn pub-primary"
              href="#hotels"
              onClick={() => setMenuOpen(false)}
            >
              Book your stay ↗
            </a>

            {checking ? (
              <span className="pub-muted">Checking session…</span>
            ) : user ? (
              <>
                {user.role === "admin" && (
                  <a href="#admin" onClick={() => setMenuOpen(false)}>
                    Dashboard
                  </a>
                )}

                {user.role === "guest" && (
                  <a href="#bookings" onClick={() => setMenuOpen(false)}>
                    My Bookings
                  </a>
                )}

                <a href="#account" onClick={() => setMenuOpen(false)}>
                  Account
                </a>

                <button type="button" onClick={logout} disabled={busy}>
                  {busy ? "Please wait…" : "Sign out"}
                </button>
              </>
            ) : (
              <a
                className="pub-btn"
                href="#login"
                onClick={() => setMenuOpen(false)}
              >
                Sign in ↗
              </a>
            )}
          </div>
        </nav>
      </header>

      {/* VIDEO HERO */}

      {page === "home" && (
        <section className="pub-hero">
          <HeroVideo />

          <div className="pub-hero-copy">
            <span className="pub-kicker">
              WELCOME TO LUXURYSTAY
            </span>

            <h1>
              Exceptional places.
              <br />
              <em>Unforgettable stays.</em>
            </h1>

            <p>
              Discover your next escape. Explore our hotels, find
              the room that feels right, and make yourself at home.
            </p>

            <div className="pub-actions">
              <a className="pub-btn pub-gold" href="#hotels">
                Book your stay ↗
              </a>
              <a className="pub-btn pub-outline-light" href="#about">
                Our story
              </a>
            </div>

            <span className="pub-hero-note">
              YOUR NEXT CHAPTER BEGINS HERE
            </span>
          </div>
        </section>
      )}

      <main id="public-main" className="pub-main" tabIndex={-1}>
        {error && (
          <div className="pub-alert" role="alert">{error}</div>
        )}

        {notice && (
          <div className="pub-success" role="status">{notice}</div>
        )}

        {/* HOME AND HOTELS */}

        {(page === "home" || page === "hotels") && (
          <>
            <div className="pub-heading">
              <div>
                <span className="pub-kicker">
                  THE LUXURYSTAY COLLECTION
                </span>
                <h1>
                  {page === "home"
                    ? "Find your perfect place."
                    : "Book your next stay."}
                </h1>
              </div>

              <p className="pub-muted">
                Choose your hotel, select travel dates, and reserve
                an available room with your guest account.
              </p>
            </div>

            {hotelCatalogue()}

            {page === "home" && (
              <>
                <section className="pub-story">
                  <div className="pub-story-image">
                    <img
                      src={PHOTOS.room}
                      alt="Illustrative hotel bedroom"
                      loading="lazy"
                    />
                    <span>Illustrative photography</span>
                  </div>

                  <div>
                    <span className="pub-kicker">
                      A MORE PERSONAL STAY
                    </span>

                    <h2>
                      Room to relax.
                      <br />
                      <em>Space to be yourself.</em>
                    </h2>

                    <p>
                      A city break, a business trip, or time away
                      together: start with a room that suits your plans.
                    </p>

                    <div className="pub-benefits">
                      <div>
                        <span>01</span>
                        <p>
                          <strong>Explore the details</strong>
                          <br />
                          Compare room types, capacity and amenities.
                        </p>
                      </div>

                      <div>
                        <span>02</span>
                        <p>
                          <strong>Review your stay</strong>
                          <br />
                          See accommodation pricing and tax before
                          confirming.
                        </p>
                      </div>

                      <div>
                        <span>03</span>
                        <p>
                          <strong>Keep everything together</strong>
                          <br />
                          Find online reservations in your guest account.
                        </p>
                      </div>
                    </div>

                    <a className="pub-btn pub-primary" href="#hotels">
                      Book your stay ↗
                    </a>
                  </div>
                </section>

                <section className="pub-strip">
                  <div>
                    <span className="pub-kicker">
                      LET YOUR NEXT JOURNEY BEGIN
                    </span>
                    <h2>A warm welcome is waiting.</h2>
                    <p>
                      Explore our collection or contact your chosen
                      hotel for help planning your visit.
                    </p>
                  </div>

                  <a className="pub-btn pub-gold" href="#contact">
                    Contact us ↗
                  </a>
                </section>
              </>
            )}
          </>
        )}

        {/* ABOUT */}

        {page === "about" && (
          <>
            <div className="pub-heading">
              <div>
                <span className="pub-kicker">OUR STORY</span>
                <h1>The art of feeling welcome.</h1>
              </div>
            </div>

            <section className="pub-story">
              <div className="pub-story-image">
                <img src={PHOTOS.room} alt="Illustrative guest room" />
                <span>Illustrative photography</span>
              </div>

              <div>
                <span className="pub-kicker">
                  LUXURYSTAY HOSPITALITY
                </span>

                <h2>
                  Your journey.
                  <br />
                  <em>Your kind of stay.</em>
                </h2>

                <p>
                  LuxuryStay brings our hotel collection together in
                  one place. Explore properties, compare room details,
                  and plan your next visit.
                </p>

                <p>
                  Your guest account keeps your online reservations
                  together. For arrival arrangements and special
                  requirements, contact your chosen hotel directly.
                </p>

                <a className="pub-btn pub-primary" href="#hotels">
                  Book your stay ↗
                </a>
              </div>
            </section>
          </>
        )}

        {/* CONTACT */}

        {page === "contact" && (
          <>
            <div className="pub-heading">
              <div>
                <span className="pub-kicker">LET'S PLAN YOUR STAY</span>
                <h1>Get in touch.</h1>
              </div>

              <p className="pub-muted">
                Contact your chosen property for arrival questions
                and special arrangements.
              </p>
            </div>

            {hotelCatalogue(true)}
          </>
        )}

        {/* ROOMS AND RESERVATION */}

        {page === "rooms" && (
          <>
            {confirmation ? (
              <section className="pub-booking pub-confirmation">
                <span className="pub-kicker">
                  RESERVATION CONFIRMED
                </span>

                <h1>We look forward to welcoming you.</h1>
                <p className="pub-reference">
                  {confirmation.bookingReference}
                </p>
                <h3>{confirmation.hotel?.name}</h3>

                <p>
                  {confirmation.checkInDate} →{" "}
                  {confirmation.checkOutDate}
                  {" · "}{confirmation.nights} nights
                  {" · "}{confirmation.numberOfGuests} guests
                </p>

                <p className="pub-price">
                  {money(
                    confirmation.totalMinor,
                    confirmation.currency
                  )}
                </p>

                <p className="pub-muted">
                  Accommodation including tax. No online payment was
                  taken. Additional services are charged separately.
                </p>

                <a className="pub-btn pub-primary" href="#bookings">
                  View my bookings ↗
                </a>
              </section>
            ) : !selectedHotel ? (
              <div className="pub-empty">
                Choose a hotel to browse its rooms.
                <div className="pub-actions">
                  <a className="pub-btn pub-primary" href="#hotels">
                    Choose a hotel
                  </a>
                </div>
              </div>
            ) : (
              <>
                <div className="pub-heading">
                  <div>
                    <span className="pub-kicker">
                      {selectedHotel.city} · {selectedHotel.country}
                    </span>
                    <h1>{selectedHotel.name}</h1>
                    <p className="pub-muted">{selectedHotel.address}</p>
                  </div>

                  <a className="pub-btn" href="#hotels">
                    Change hotel
                  </a>
                </div>

                <form className="pub-search" onSubmit={searchRooms}>
                  <label>
                    Check-in
                    <input
                      type="date"
                      required
                      disabled={busy}
                      value={search.checkInDate}
                      onChange={(event) =>
                        setSearch({
                          ...search,
                          checkInDate: event.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                    Check-out
                    <input
                      type="date"
                      required
                      disabled={busy}
                      value={search.checkOutDate}
                      onChange={(event) =>
                        setSearch({
                          ...search,
                          checkOutDate: event.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                    Guests
                    <input
                      type="number"
                      required
                      min="1"
                      max="20"
                      disabled={busy}
                      value={search.guests}
                      onChange={(event) =>
                        setSearch({
                          ...search,
                          guests: event.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                    Room type
                    <select
                      disabled={busy}
                      value={search.roomType}
                      onChange={(event) =>
                        setSearch({
                          ...search,
                          roomType: event.target.value,
                        })
                      }
                    >
                      <option value="">All types</option>
                      {ROOM_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {label(type)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    className="pub-primary"
                    disabled={busy || roomLoading}
                  >
                    {roomLoading ? "Searching…" : "Check availability"}
                  </button>
                </form>

                {roomError && (
                  <div className="pub-alert" role="alert">
                    {roomError}
                  </div>
                )}

                {selectedRoom ? (
                  <section className="pub-detail">
                    <div>
                      <img
                        src={PHOTOS.room}
                        alt="Illustrative guest room"
                      />
                      <p className="pub-muted">
                        Illustrative photography
                      </p>

                      <h2>{label(selectedRoom.roomType)} Room</h2>
                      <p>{selectedRoom.description}</p>

                      <p className="pub-muted">
                        {selectedRoom.numberOfBeds}{" "}
                        {label(selectedRoom.bedType)} bed(s)
                        {" · "}Up to {selectedRoom.capacity} guests
                      </p>

                      <div className="pub-tags">
                        {(selectedRoom.amenities || []).map((item) => (
                          <span key={item}>{label(item)}</span>
                        ))}
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setSelectedRoom(null);
                          pendingRequest.current = null;
                          setError("");
                        }}
                      >
                        Back to results
                      </button>
                    </div>

                    <div>
                      <span className="pub-kicker">
                        REVIEW YOUR STAY
                      </span>
                      <h2>Your reservation</h2>

                      <p>
                        {searched.checkInDate} →{" "}
                        {searched.checkOutDate}
                        <br />
                        {searched.guests} guest(s)
                      </p>

                      <div className="pub-totals">
                        <div>
                          <span>{selectedRoom.quote.nights} nights</span>
                          <span>
                            {money(
                              selectedRoom.quote.subtotalMinor,
                              selectedRoom.quote.currency
                            )}
                          </span>
                        </div>

                        <div>
                          <span>
                            Tax ({selectedRoom.quote.taxRateBps / 100}%)
                          </span>
                          <span>
                            {money(
                              selectedRoom.quote.taxAmountMinor,
                              selectedRoom.quote.currency
                            )}
                          </span>
                        </div>

                        <div>
                          <span>Total</span>
                          <span>
                            {money(
                              selectedRoom.quote.totalMinor,
                              selectedRoom.quote.currency
                            )}
                          </span>
                        </div>
                      </div>

                      {checking ? (
                        <p>Checking your account…</p>
                      ) : !user ? (
                        <>
                          <p>
                            Sign in or create a guest account to
                            reserve this stay.
                          </p>

                          <div className="pub-actions">
                            <a
                              className="pub-btn pub-primary"
                              href="#login"
                            >
                              Sign in
                            </a>
                            <a className="pub-btn" href="#register">
                              Create account
                            </a>
                          </div>
                        </>
                      ) : user.role !== "guest" ? (
                        <p>
                          Online booking requires a guest account.
                          Admin bookings are available in the dashboard.
                        </p>
                      ) : (
                        <form className="pub-form" onSubmit={book}>
                          <p>
                            Booking for <strong>{user.name}</strong>
                            <br />
                            {user.email}
                          </p>

                          <label>
                            Contact phone
                            <input
                              type="tel"
                              autoComplete="tel"
                              required
                              maxLength={25}
                              readOnly={Boolean(pendingRequest.current)}
                              disabled={busy}
                              value={bookingForm.guestPhone}
                              onChange={(event) =>
                                setBookingForm({
                                  ...bookingForm,
                                  guestPhone: event.target.value,
                                })
                              }
                            />
                          </label>

                          <label>
                            Special requests (optional)
                            <textarea
                              rows={3}
                              maxLength={2000}
                              readOnly={Boolean(pendingRequest.current)}
                              disabled={busy}
                              value={bookingForm.specialRequests}
                              onChange={(event) =>
                                setBookingForm({
                                  ...bookingForm,
                                  specialRequests: event.target.value,
                                })
                              }
                            />
                          </label>

                          <p className="pub-muted">
                            No online payment is taken. Additional
                            services are charged separately. Online
                            cancellation is available before the arrival
                            date. Special requests are subject to
                            availability.
                          </p>

                          <button
                            className="pub-primary"
                            disabled={busy}
                          >
                            {busy ? "Confirming…" : "Confirm reservation"}
                          </button>
                        </form>
                      )}
                    </div>
                  </section>
                ) : roomLoading ? (
                  <div className="pub-empty" role="status">
                    Finding available rooms…
                  </div>
                ) : searched && !roomError ? (
                  <>
                    <p className="pub-muted">
                      {searched.checkInDate} → {searched.checkOutDate}
                      {" · "}{searched.guests} guest(s). Availability
                      is checked again at confirmation.
                    </p>

                    {rooms.length === 0 ? (
                      <div className="pub-empty">
                        No rooms match these dates. Try another date
                        or room type.
                      </div>
                    ) : (
                      <div className="pub-grid">
                        {rooms.map((room) => (
                          <article className="pub-card" key={room._id}>
                            <div className="pub-image-wrap">
                              <img
                                className="pub-card-img"
                                src={PHOTOS.room}
                                alt="Illustrative guest room"
                                loading="lazy"
                              />
                              <span className="pub-image-note">
                                Illustrative photo
                              </span>
                            </div>

                            <div className="pub-card-body">
                              <span className="pub-location">
                                {label(room.roomType)}
                              </span>
                              <h3>{label(room.roomType)} Room</h3>

                              <p className="pub-muted">
                                Up to {room.capacity} guests ·{" "}
                                {label(room.bedType)} bed
                              </p>

                              <p className="pub-price">
                                {money(
                                  room.pricePerNightMinor,
                                  room.quote.currency
                                )}
                              </p>

                              <p className="pub-muted">
                                Per night, before tax
                              </p>

                              <p>
                                Stay total:{" "}
                                <strong>
                                  {money(
                                    room.quote.totalMinor,
                                    room.quote.currency
                                  )}
                                </strong>
                              </p>

                              <button
                                type="button"
                                className="pub-primary"
                                disabled={busy}
                                onClick={() => chooseRoom(room)}
                              >
                                Details & reserve ↗
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}

                    <Pager
                      page={roomPage}
                      pages={roomPages}
                      disabled={roomLoading || busy}
                      onChange={setRoomPage}
                    />
                  </>
                ) : !roomError ? (
                  <div className="pub-empty">
                    Enter your travel dates to check availability.
                  </div>
                ) : null}
              </>
            )}
          </>
        )}

        {/* LOGIN AND REGISTER */}

        {(page === "login" || page === "register") && (
          <section className="pub-auth">
            {checking ? (
              <p role="status">Checking your account…</p>
            ) : user ? (
              <>
                <h1>You are signed in.</h1>
                <a
                  className="pub-btn pub-primary"
                  href={user.role === "admin" ? "#admin" : "#account"}
                >
                  Open your workspace
                </a>
              </>
            ) : (
              <>
                <span className="pub-kicker">
                  YOUR LUXURYSTAY ACCOUNT
                </span>

                <h1>
                  {page === "register"
                    ? "Begin your journey."
                    : "Welcome back."}
                </h1>

                <p className="pub-muted">
                  {page === "register"
                    ? "Create a guest account for your next stay."
                    : "Sign in to your guest or staff account."}
                </p>

                <form className="pub-form" onSubmit={authenticate}>
                  <fieldset disabled={busy} className="pub-form">
                    {page === "register" && (
                      <label>
                        Full name
                        <input
                          autoComplete="name"
                          required
                          minLength={2}
                          maxLength={100}
                          value={account.name}
                          onChange={(event) =>
                            setAccount({
                              ...account,
                              name: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}

                    <label>
                      Email address
                      <input
                        type="email"
                        autoComplete="username"
                        required
                        maxLength={254}
                        value={account.email}
                        onChange={(event) =>
                          setAccount({
                            ...account,
                            email: event.target.value,
                          })
                        }
                      />
                    </label>

                    {page === "register" && (
                      <label>
                        Phone (optional)
                        <input
                          type="tel"
                          autoComplete="tel"
                          maxLength={25}
                          value={account.phone}
                          onChange={(event) =>
                            setAccount({
                              ...account,
                              phone: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}

                    <label htmlFor="public-password">Password</label>

                    <div className="pub-password">
                      <input
                        id="public-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete={
                          page === "register"
                            ? "new-password"
                            : "current-password"
                        }
                        required
                        minLength={page === "register" ? 12 : undefined}
                        value={account.password}
                        onChange={(event) =>
                          setAccount({
                            ...account,
                            password: event.target.value,
                          })
                        }
                      />

                      <button
                        type="button"
                        aria-pressed={showPassword}
                        onClick={() =>
                          setShowPassword((value) => !value)
                        }
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>

                    {page === "register" && (
                      <label>
                        Confirm password
                        <input
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          required
                          value={account.confirmPassword}
                          onChange={(event) =>
                            setAccount({
                              ...account,
                              confirmPassword: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}

                    <button className="pub-primary">
                      {busy
                        ? "Please wait…"
                        : page === "register"
                          ? "Create guest account"
                          : "Sign in"}
                    </button>
                  </fieldset>
                </form>

                <p className="pub-muted">
                  {page === "register"
                    ? "Already registered? "
                    : "New to LuxuryStay? "}

                  <button
                    type="button"
                    className="pub-link-button"
                    disabled={busy}
                    onClick={() => {
                      setAccount({
                        ...EMPTY_ACCOUNT,
                        email: account.email,
                      });
                      setShowPassword(false);
                      go(page === "register" ? "login" : "register");
                    }}
                  >
                    {page === "register"
                      ? "Sign in"
                      : "Create an account"}
                  </button>
                </p>
              </>
            )}
          </section>
        )}

        {/* ACCOUNT */}

        {(page === "account" || page === "admin") && (
          <section className="pub-auth">
            {checking ? (
              <p>Checking your account…</p>
            ) : !user ? (
              <>
                <h1>Your account</h1>
                <a className="pub-btn pub-primary" href="#login">
                  Sign in
                </a>
              </>
            ) : (
              <>
                <span className="pub-kicker">
                  {label(user.role)} ACCOUNT
                </span>

                <h1>Welcome, {user.name}.</h1>
                <p>{user.email}</p>
                <p className="pub-muted">
                  {user.phone || "Phone not provided"}
                </p>

                <div className="pub-actions">
                  {user.role === "guest" && (
                    <>
                      <a className="pub-btn pub-primary" href="#hotels">
                        Book your stay ↗
                      </a>
                      <a className="pub-btn" href="#bookings">
                        My bookings
                      </a>
                    </>
                  )}

                  {user.role === "admin" && (
                    <a className="pub-btn pub-primary" href="#admin">
                      Admin dashboard
                    </a>
                  )}

                  {!["admin", "guest"].includes(user.role) && (
                    <p className="pub-muted">
                      Your staff account is signed in. A dedicated
                      staff workspace has not been connected yet.
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* MY BOOKINGS */}

        {page === "bookings" && (
          <>
            <div className="pub-heading">
              <div>
                <span className="pub-kicker">YOUR GUEST SPACE</span>
                <h1>My bookings</h1>
              </div>

              <button
                type="button"
                disabled={busy || bookingLoading}
                onClick={() =>
                  setBookingRefresh((value) => value + 1)
                }
              >
                Refresh
              </button>
            </div>

            {checking ? (
              <p>Checking your account…</p>
            ) : !user ? (
              <div className="pub-empty">
                Sign in to see your reservations.
                <div className="pub-actions">
                  <a className="pub-btn pub-primary" href="#login">
                    Sign in
                  </a>
                </div>
              </div>
            ) : user.role !== "guest" ? (
              <div className="pub-empty">
                This page is for guest accounts.
              </div>
            ) : bookingLoading ? (
              <div className="pub-empty" role="status">
                Loading your bookings…
              </div>
            ) : bookingError ? (
              <div className="pub-alert" role="alert">
                {bookingError}
              </div>
            ) : (
              <>
                {bookings.length === 0 ? (
                  <div className="pub-empty">
                    You have no online reservations yet.
                    <div className="pub-actions">
                      <a className="pub-btn pub-primary" href="#hotels">
                        Book your stay ↗
                      </a>
                    </div>
                  </div>
                ) : (
                  bookings.map((booking) => (
                    <article className="pub-booking" key={booking._id}>
                      <div className="pub-row">
                        <span className="pub-reference">
                          {booking.bookingReference}
                        </span>
                        <span className="pub-status">
                          {label(booking.status)}
                        </span>
                      </div>

                      <h3>{booking.hotel?.name || "Hotel"}</h3>

                      <p>
                        {label(booking.room?.roomType || "Room")}
                        {" · "}
                        {booking.checkInDate} → {booking.checkOutDate}
                      </p>

                      <p className="pub-muted">
                        {booking.nights} nights ·{" "}
                        {booking.numberOfGuests} guests · Contact:{" "}
                        {booking.guestPhone}
                      </p>

                      <p className="pub-price">
                        {money(booking.totalMinor, booking.currency)}
                      </p>

                      <p className="pub-muted">
                        Accommodation including tax; additional
                        services excluded.
                      </p>

                      {booking.specialRequests && (
                        <p>{booking.specialRequests}</p>
                      )}

                      {booking.status === "confirmed" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setCancelTarget(booking);
                            setCancelReason("");
                            setError("");
                          }}
                        >
                          Request cancellation
                        </button>
                      )}

                      {cancelTarget?._id === booking._id && (
                        <form
                          className="pub-form pub-cancel"
                          onSubmit={cancelBooking}
                        >
                          <strong>Cancel this reservation?</strong>

                          <p className="pub-muted">
                            Online cancellation is allowed before the
                            arrival date. This action does not process
                            refunds.
                          </p>

                          <label>
                            Reason (optional)
                            <textarea
                              rows={2}
                              maxLength={500}
                              disabled={busy}
                              value={cancelReason}
                              onChange={(event) =>
                                setCancelReason(event.target.value)
                              }
                            />
                          </label>

                          <div className="pub-actions">
                            <button
                              className="pub-primary"
                              disabled={busy}
                            >
                              {busy
                                ? "Cancelling…"
                                : "Yes, cancel reservation"}
                            </button>

                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setCancelTarget(null)}
                            >
                              Keep reservation
                            </button>
                          </div>
                        </form>
                      )}
                    </article>
                  ))
                )}

                <Pager
                  page={bookingPage}
                  pages={bookingPages}
                  disabled={bookingLoading || busy}
                  onChange={(value) => {
                    setCancelTarget(null);
                    setBookingPage(value);
                  }}
                />
              </>
            )}
          </>
        )}
      </main>

      {/* FOOTER */}

      <footer className="pub-footer">
        <div className="pub-footer-grid">
          <div>
            <Logo />
            <p>
              Thoughtful spaces. Warm welcomes.
              <br />
              Your next stay begins here.
            </p>
          </div>

          <div>
            <h3>Explore</h3>
            <a href="#home">Home</a>
            <a href="#hotels">Our hotels</a>
            <a href="#about">About LuxuryStay</a>
          </div>

          <div>
            <h3>Your stay</h3>
            <a href="#hotels">Book your stay ↗</a>
            <a href="#account">Your account</a>
            <a href="#bookings">My bookings</a>
            <a href="#contact">Contact your hotel</a>
          </div>
        </div>

        <div className="pub-footer-bottom">
          <span>
            © {new Date().getFullYear()} LuxuryStay Hospitality
          </span>
          <span>A warm welcome, always.</span>
        </div>
      </footer>

      <WhatsAppButton />
    </div>
  );
}