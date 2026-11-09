import { useEffect, useRef, useState } from "react";

const TYPES = [
  ["reservation", "Reservations"],
  ["check_in", "Check-in"],
  ["check_out", "Check-out"],
  ["housekeeping", "Housekeeping"],
  ["maintenance", "Maintenance"],
  ["service", "Guest services"],
  ["billing", "Billing"],
  ["feedback", "Feedback"],
  ["announcement", "Announcements"],
  ["system", "System"],
];

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || data?.success !== true) {
    throw new Error(
      response.status === 401
        ? "Your session expired. Please log in again."
        : response.status === 403
        ? "You do not have permission to perform this action."
        : data?.message || "The request could not be completed."
    );
  }

  return data;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  });
}

function typeLabel(value) {
  return TYPES.find(([type]) => type === value)?.[1] || "Notification";
}

function BellIcon({ size = 24 }) {
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
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

export default function NotificationManagement() {
  const [archived, setArchived] = useState(false);
  const [read, setRead] = useState("all");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);

  const [list, setList] = useState({
    key: "",
    notifications: [],
    total: 0,
    pages: 1,
    loading: true,
    error: "",
  });

  const [count, setCount] = useState({
    value: null,
    loading: true,
    error: "",
  });

  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmReadAll, setConfirmReadAll] = useState(false);

  const mounted = useRef(false);
  const writeLock = useRef(false);

  // Incrementing this invalidates reads that started before a mutation.
  const readGeneration = useRef(0);

  const query = new URLSearchParams({
    page: String(page),
    limit: "10",
    archived: String(archived),
    read,
  });

  if (type) query.set("type", type);
  if (priority) query.set("priority", priority);

  const url = `/api/notifications?${query.toString()}`;
  const listKey = `${url}|${refresh}`;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const generation = readGeneration.current;

    setList({
      key: listKey,
      notifications: [],
      total: 0,
      pages: 1,
      loading: true,
      error: "",
    });

    async function loadNotifications() {
      try {
        const data = await api(url, {
          signal: controller.signal,
        });

        const pagination = data.pagination;

        if (
          !Array.isArray(data.notifications) ||
          !Number.isSafeInteger(pagination?.total) ||
          pagination.total < 0 ||
          !Number.isSafeInteger(pagination?.pages) ||
          pagination.pages < 1
        ) {
          throw new Error("The server returned an invalid notification list.");
        }

        if (
          controller.signal.aborted ||
          generation !== readGeneration.current
        ) {
          return;
        }

        // Archiving or marking the last item read can remove a page.
        if (page > pagination.pages) {
          setPage(pagination.pages);
          return;
        }

        setList({
          key: listKey,
          notifications: data.notifications,
          total: pagination.total,
          pages: pagination.pages,
          loading: false,
          error: "",
        });
      } catch (error) {
        if (
          !controller.signal.aborted &&
          generation === readGeneration.current
        ) {
          setList({
            key: listKey,
            notifications: [],
            total: 0,
            pages: 1,
            loading: false,
            error: error.message || "Unable to load notifications.",
          });
        }
      }
    }

    loadNotifications();

    return () => controller.abort();
  }, [url, listKey, page, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = readGeneration.current;

    setCount({
      value: null,
      loading: true,
      error: "",
    });

    async function loadCount() {
      try {
        const data = await api("/api/notifications/unread-count", {
          signal: controller.signal,
        });

        if (
          !Number.isSafeInteger(data.unreadCount) ||
          data.unreadCount < 0
        ) {
          throw new Error("The server returned an invalid unread count.");
        }

        if (
          !controller.signal.aborted &&
          generation === readGeneration.current
        ) {
          setCount({
            value: data.unreadCount,
            loading: false,
            error: "",
          });
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          generation === readGeneration.current
        ) {
          setCount({
            value: null,
            loading: false,
            error: error.message || "Unable to load unread count.",
          });
        }
      }
    }

    loadCount();

    return () => controller.abort();
  }, [refresh]);

  const currentList =
    list.key === listKey
      ? list
      : {
          notifications: [],
          total: 0,
          pages: 1,
          loading: true,
          error: "",
        };

  function resetFeedback() {
    setActionError("");
    setMessage("");
    setConfirmReadAll(false);
  }

  function switchFolder(value) {
    if (writeLock.current) return;

    setArchived(value);
    setPage(1);
    resetFeedback();
  }

  function refreshInbox() {
    if (writeLock.current) return;

    resetFeedback();
    setRefresh((value) => value + 1);
  }

  async function updateNotification(actionKey, endpoint, body) {
    if (writeLock.current) return;

    writeLock.current = true;
    readGeneration.current += 1;
    setBusy(actionKey);
    setActionError("");
    setMessage("");
    setConfirmReadAll(false);

    try {
      const result = await api(endpoint, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      if (mounted.current) {
        setMessage(result.message || "Notification updated.");
      }
    } catch (error) {
      if (mounted.current) {
        setActionError(
          error.message ||
            "The update could not be confirmed. Refresh and check its status."
        );
      }
    } finally {
      writeLock.current = false;

      if (mounted.current) {
        setBusy("");
        // Reload after success or failure to reconcile server state.
        setRefresh((value) => value + 1);
      }
    }
  }

  const controlsDisabled = Boolean(busy);

  return (
    <div className="nm-root">
      <style>{styles}</style>

      <header className="nm-heading">
        <div>
          <p className="nm-eyebrow">YOUR WORKSPACE UPDATES</p>
          <h1>Notifications</h1>
          <p className="nm-muted">
            View your updates and keep your inbox organised.
          </p>
        </div>

        <button
          type="button"
          className="nm-secondary"
          disabled={controlsDisabled || currentList.loading || count.loading}
          onClick={refreshInbox}
        >
          Refresh
        </button>
      </header>

      <section className="nm-summary">
        <div className="nm-summary-icon">
          <BellIcon size={30} />
        </div>

        <div>
          <span>Unread in your inbox</span>
          <strong>
            {count.loading ? "…" : count.value ?? "—"}
          </strong>
          <p>Archived notifications are excluded.</p>
        </div>
      </section>

      {count.error && (
        <p className="nm-error" role="alert">{count.error}</p>
      )}

      {actionError && (
        <p className="nm-error" role="alert">{actionError}</p>
      )}

      {message && (
        <p className="nm-success" role="status">{message}</p>
      )}

      <section className="nm-panel">
        <div className="nm-heading">
          <div className="nm-tabs" aria-label="Notification folders">
            <button
              type="button"
              className={!archived ? "nm-tab selected" : "nm-tab"}
              aria-pressed={!archived}
              disabled={controlsDisabled}
              onClick={() => switchFolder(false)}
            >
              Inbox
            </button>

            <button
              type="button"
              className={archived ? "nm-tab selected" : "nm-tab"}
              aria-pressed={archived}
              disabled={controlsDisabled}
              onClick={() => switchFolder(true)}
            >
              Archived
            </button>
          </div>

          {!archived && (
            <button
              type="button"
              className="nm-secondary"
              disabled={
                controlsDisabled ||
                count.loading ||
                !Number.isSafeInteger(count.value) ||
                count.value === 0
              }
              onClick={() => setConfirmReadAll(true)}
            >
              Mark entire inbox as read
            </button>
          )}
        </div>

        {confirmReadAll && (
          <div className="nm-confirm">
            <p>
              Mark every unread notification in your inbox as read?
              This includes notifications outside the current filters.
            </p>

            <div className="nm-actions">
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() =>
                  updateNotification(
                    "read-all",
                    "/api/notifications/read-all",
                    {}
                  )
                }
              >
                Mark all as read
              </button>

              <button
                type="button"
                className="nm-secondary"
                disabled={controlsDisabled}
                onClick={() => setConfirmReadAll(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="nm-filters">
          <label>
            Read status
            <select
              value={read}
              disabled={controlsDisabled}
              onChange={(event) => {
                setRead(event.target.value);
                setPage(1);
                resetFeedback();
              }}
            >
              <option value="all">All notifications</option>
              <option value="unread">Unread only</option>
              <option value="read">Read only</option>
            </select>
          </label>

          <label>
            Category
            <select
              value={type}
              disabled={controlsDisabled}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
                resetFeedback();
              }}
            >
              <option value="">All categories</option>
              {TYPES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Priority
            <select
              value={priority}
              disabled={controlsDisabled}
              onChange={(event) => {
                setPriority(event.target.value);
                setPage(1);
                resetFeedback();
              }}
            >
              <option value="">All priorities</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>

        <div className="nm-list-heading">
          <h2>{archived ? "Archived notifications" : "Your inbox"}</h2>
          <span className="nm-muted">
            {currentList.loading ? "Loading…" : `${currentList.total} matching record(s)`}
          </span>
        </div>

        {currentList.error && (
          <p className="nm-error" role="alert">{currentList.error}</p>
        )}

        {currentList.loading ? (
          <div className="nm-empty" role="status">
            Loading notifications...
          </div>
        ) : currentList.error ? (
          <button
            type="button"
            className="nm-secondary"
            disabled={controlsDisabled}
            onClick={refreshInbox}
          >
            Try again
          </button>
        ) : currentList.notifications.length === 0 ? (
          <div className="nm-empty">
            <BellIcon size={35} />
            <h3>No notifications found</h3>
            <p>
              {archived
                ? "Archived updates will appear here."
                : "New updates addressed to your account will appear here."}
            </p>
          </div>
        ) : (
          <div className="nm-list" aria-busy={controlsDisabled}>
            {currentList.notifications.map((notification) => {
              const isRead = Boolean(notification.readAt);
              const isArchived = Boolean(notification.archivedAt);

              const changing =
                busy === `read-${notification._id}` ||
                busy === `archive-${notification._id}`;

              return (
                <article
                  key={notification._id}
                  className={`nm-notification ${isRead ? "" : "nm-unread"}`}
                >
                  <div className="nm-notification-icon">
                    <BellIcon size={21} />
                  </div>

                  <div className="nm-notification-content">
                    <div className="nm-notification-top">
                      <div className="nm-tags">
                        <span className="nm-category">
                          {typeLabel(notification.type)}
                        </span>

                        <span className={`nm-priority nm-${notification.priority}`}>
                          {notification.priority}
                        </span>

                        {!isRead && (
                          <span className="nm-unread-label">Unread</span>
                        )}
                      </div>

                      <time dateTime={notification.createdAt}>
                        {formatDate(notification.createdAt)}
                      </time>
                    </div>

                    <h3>{notification.title}</h3>
                    <p className="nm-message">{notification.message}</p>

                    <div className="nm-notification-footer">
                      <small className="nm-muted">
                        {isArchived
                          ? `Archived: ${formatDate(notification.archivedAt)}`
                          : isRead
                          ? `Read: ${formatDate(notification.readAt)}`
                          : "Not read yet"}
                      </small>

                      <div className="nm-actions">
                        <button
                          type="button"
                          className="nm-secondary"
                          disabled={controlsDisabled}
                          onClick={() =>
                            updateNotification(
                              `read-${notification._id}`,
                              `/api/notifications/${notification._id}/read`,
                              { isRead: !isRead }
                            )
                          }
                        >
                          {busy === `read-${notification._id}`
                            ? "Saving..."
                            : isRead
                            ? "Mark unread"
                            : "Mark read"}
                        </button>

                        <button
                          type="button"
                          disabled={controlsDisabled}
                          onClick={() =>
                            updateNotification(
                              `archive-${notification._id}`,
                              `/api/notifications/${notification._id}/archive`,
                              { archived: !isArchived }
                            )
                          }
                        >
                          {busy === `archive-${notification._id}`
                            ? "Saving..."
                            : isArchived
                            ? "Restore to inbox"
                            : "Archive"}
                        </button>
                      </div>
                    </div>

                    {changing && (
                      <span className="nm-sr-only" role="status">
                        Updating notification.
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="nm-pagination">
          <button
            type="button"
            className="nm-secondary"
            disabled={controlsDisabled || currentList.loading || page <= 1}
            onClick={() => {
              setPage((value) => value - 1);
              setConfirmReadAll(false);
            }}
          >
            Previous
          </button>

          <span>
            Page {page} of {currentList.pages}
          </span>

          <button
            type="button"
            className="nm-secondary"
            disabled={
              controlsDisabled ||
              currentList.loading ||
              page >= currentList.pages
            }
            onClick={() => {
              setPage((value) => value + 1);
              setConfirmReadAll(false);
            }}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}

const styles = `
.nm-root{font-family:inherit;color:#234337;min-width:0}
.nm-root *{box-sizing:border-box}
.nm-root h1{font-size:30px;letter-spacing:-.6px;margin:0 0 8px}
.nm-root h2{font-size:20px;margin:0}
.nm-root h3{font-size:17px;margin:12px 0 8px;overflow-wrap:anywhere}
.nm-root p{line-height:1.7}
.nm-heading{display:flex;align-items:center;justify-content:space-between;
  gap:18px;flex-wrap:wrap;margin-bottom:22px}
.nm-eyebrow{font-size:10px;font-weight:800;letter-spacing:2px;color:#977743}
.nm-muted{color:#718176;font-size:13px}
.nm-root button{font:inherit;font-size:13px;font-weight:700;
  padding:11px 16px;border-radius:9px;border:1px solid #204e3b;
  background:#204e3b;color:#fff;cursor:pointer}
.nm-root button:hover:not(:disabled){background:#31664d}
.nm-root button.nm-secondary{background:#fff;color:#2a503b;border-color:#dbe4d7}
.nm-root button.nm-secondary:hover:not(:disabled){background:#f1f6ed}
.nm-root button:disabled{opacity:.5;cursor:not-allowed}
.nm-root button:focus-visible,.nm-root select:focus-visible{
  outline:3px solid #b7cda9;outline-offset:2px}
.nm-summary{display:flex;align-items:center;gap:22px;padding:25px;
  background:#eaf0e2;border:1px solid #dce5d2;border-radius:17px;margin-bottom:24px}
.nm-summary-icon{width:66px;height:66px;border-radius:18px;background:#fff;
  display:grid;place-items:center;color:#59734b;flex-shrink:0}
.nm-summary span{font-size:13px;color:#65785b}
.nm-summary strong{display:block;font-size:34px;margin-top:5px;color:#294c35}
.nm-summary p{margin:5px 0 0;font-size:12px;color:#77856d}
.nm-panel{background:#fff;padding:25px;border:1px solid #e0e7da;
  border-radius:18px}
.nm-tabs{display:flex;gap:6px;background:#f3f6ee;border-radius:11px;padding:5px}
.nm-root button.nm-tab{border:0;background:transparent;color:#758269}
.nm-root button.nm-tab.selected{background:#204e3b;color:#fff}
.nm-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:16px;padding:20px 0;border-top:1px solid #edf0e7;border-bottom:1px solid #edf0e7}
.nm-root label{display:flex;flex-direction:column;gap:8px;font-size:12px;
  font-weight:700;color:#5d735c}
.nm-root select{width:100%;padding:12px;border:1px solid #dce4d6;
  border-radius:9px;background:#fcfdf9;font:inherit;font-size:13px;color:#294b37}
.nm-list-heading{display:flex;justify-content:space-between;align-items:center;
  gap:15px;flex-wrap:wrap;margin:24px 0 18px}
.nm-list{display:grid;gap:14px}
.nm-notification{display:flex;gap:16px;padding:20px;border:1px solid #e5eadf;
  border-radius:13px;background:#fff}
.nm-notification.nm-unread{background:#f8fbf3;border-left:4px solid #66894e}
.nm-notification-icon{width:42px;height:42px;border-radius:12px;
  background:#edf2e7;display:grid;place-items:center;color:#607e4f;flex-shrink:0}
.nm-notification-content{flex:1;min-width:0}
.nm-notification-top{display:flex;align-items:center;justify-content:space-between;
  gap:12px;flex-wrap:wrap}
.nm-tags{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.nm-category{font-size:10px;letter-spacing:.5px;text-transform:uppercase;
  font-weight:800;color:#738565}
.nm-priority{font-size:10px;text-transform:capitalize;font-weight:700;
  padding:4px 8px;border-radius:20px}
.nm-normal{background:#edf2e9;color:#658052}
.nm-high{background:#fff3d5;color:#997129}
.nm-urgent{background:#ffeae5;color:#aa4b39}
.nm-unread-label{font-size:10px;color:#3d773b;font-weight:800}
.nm-notification time{font-size:11px;color:#8a9480}
.nm-message{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;
  color:#61725b;margin:8px 0 18px}
.nm-notification-footer{display:flex;justify-content:space-between;align-items:center;
  gap:14px;flex-wrap:wrap}
.nm-actions{display:flex;gap:9px;flex-wrap:wrap}
.nm-empty{text-align:center;padding:44px 20px;background:#f8faf4;
  border:1px dashed #dce5d3;border-radius:13px;color:#7b8a70}
.nm-empty svg{color:#8ca27a}
.nm-empty h3{color:#536f45}
.nm-empty p{font-size:13px;margin-bottom:0}
.nm-error,.nm-success{padding:13px 16px;border-radius:10px;
  font-size:14px;overflow-wrap:anywhere;margin:16px 0}
.nm-error{background:#fff0eb;color:#9b4434;border:1px solid #f0d7cc}
.nm-success{background:#edf7e9;color:#3c7034;border:1px solid #d7e8cc}
.nm-confirm{background:#fff8e8;padding:18px;border:1px solid #eee0ba;
  border-radius:11px;margin-bottom:20px}
.nm-confirm p{font-size:13px;color:#82703d;margin:0 0 14px}
.nm-pagination{display:flex;justify-content:flex-end;align-items:center;
  gap:14px;margin-top:24px;font-size:13px;color:#75836b}
.nm-sr-only{position:absolute;width:1px;height:1px;padding:0;
  margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:700px){
  .nm-filters{grid-template-columns:1fr}
  .nm-panel{padding:18px}
  .nm-notification{padding:16px;gap:12px}
  .nm-notification-footer{align-items:flex-start;flex-direction:column}
}
@media(max-width:450px){
  .nm-root h1{font-size:25px}
  .nm-summary{padding:20px;gap:15px}
  .nm-summary-icon{width:52px;height:52px}
  .nm-notification-icon{display:none}
  .nm-pagination{justify-content:center;gap:9px;flex-wrap:wrap}
  .nm-actions{width:100%}
  .nm-actions button{flex:1}
}
`;