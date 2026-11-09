import { useEffect, useRef, useState } from "react";

const RATING_FIELDS = [
  ["overallRating", "Overall experience"],
  ["cleanlinessRating", "Cleanliness"],
  ["serviceRating", "Service"],
  ["comfortRating", "Comfort"],
  ["valueRating", "Value for money"],
];

const EMPTY_FORM = {
  reservation: "",
  overallRating: "",
  cleanlinessRating: "",
  serviceRating: "",
  comfortRating: "",
  valueRating: "",
  title: "",
  comment: "",
};

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
    const error = new Error(
      response.status === 401
        ? "Your session expired. Please log in again."
        : response.status === 403
        ? "You do not have permission to access this feature."
        : data?.message || "The request could not be completed."
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

function useList(url, field, refresh) {
  const key = `${url}|${refresh}`;

  const empty = {
    items: [],
    total: 0,
    pages: 1,
    loading: true,
    error: "",
  };

  const [state, setState] = useState({ ...empty, key: "" });

  useEffect(() => {
    const controller = new AbortController();

    setState({
      key,
      items: [],
      total: 0,
      pages: 1,
      loading: true,
      error: "",
    });

    async function load() {
      try {
        const data = await api(url, {
          signal: controller.signal,
        });

        const items = data[field];
        const pagination = data.pagination;

        if (
          !Array.isArray(items) ||
          !Number.isSafeInteger(pagination?.total) ||
          pagination.total < 0 ||
          !Number.isSafeInteger(pagination?.pages) ||
          pagination.pages < 0 ||
          (pagination.pages === 0 && pagination.total !== 0)
        ) {
          throw new Error("The server returned an invalid list.");
        }

        if (!controller.signal.aborted) {
          setState({
            key,
            items,
            total: pagination.total,
            pages: Math.max(1, pagination.pages),
            loading: false,
            error: "",
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            key,
            items: [],
            total: 0,
            pages: 1,
            loading: false,
            error: error.message || "Unable to load records.",
          });
        }
      }
    }

    load();
    return () => controller.abort();
  }, [url, field, refresh, key]);

  return state.key === key ? state : empty;
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

function Stars({ value }) {
  const valid = Number.isInteger(value) && value >= 1 && value <= 5;

  if (!valid) return <span className="fm-muted">Not rated</span>;

  return (
    <span className="fm-stars" aria-label={`${value} out of 5`}>
      <span aria-hidden="true">
        {"★".repeat(value)}
        <span className="fm-empty-stars">{"★".repeat(5 - value)}</span>
      </span>
      <strong>{value}/5</strong>
    </span>
  );
}

function Pager({ page, pages, disabled, onChange }) {
  return (
    <div className="fm-pagination">
      <button
        type="button"
        className="fm-secondary"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>

      <span>Page {page} of {pages}</span>

      <button
        type="button"
        className="fm-secondary"
        disabled={disabled || page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

function FeedbackEditor({ record, onClose, onSaved }) {
  const [form, setForm] = useState({
    status: record.status,
    internalNotes: record.internalNotes || "",
    managementResponse: record.managementResponse || "",
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function save(event) {
    event.preventDefault();
    if (locked.current || conflict) return;

    if (!Number.isSafeInteger(record.version)) {
      setError("The record version is missing. Close and refresh the list.");
      return;
    }

    const payload = { version: record.version };

    if (form.status !== record.status) {
      payload.status = form.status;
    }

    if (form.internalNotes.trim() !== (record.internalNotes || "")) {
      payload.internalNotes = form.internalNotes.trim();
    }

    if (
      form.managementResponse.trim() !==
      (record.managementResponse || "")
    ) {
      payload.managementResponse = form.managementResponse.trim();
    }

    if (Object.keys(payload).length === 1) {
      setError("Make a change before saving.");
      return;
    }

    locked.current = true;
    setBusy(true);
    setError("");

    try {
      await api(`/api/feedback/${record._id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (mounted.current) onSaved();
    } catch (err) {
      if (mounted.current) {
        setError(err.message);
        if (err.status === 409) setConflict(true);
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="fm-panel">
      <div className="fm-heading">
        <div>
          <p className="fm-eyebrow">MANAGE FEEDBACK</p>
          <h2>{record.title}</h2>
          <p className="fm-muted">
            {record.guestName} · {record.bookingReference}
          </p>
        </div>

        <button
          type="button"
          className="fm-secondary"
          disabled={busy}
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="fm-quote">
        <Stars value={record.overallRating} />
        <p className="fm-preserve">{record.comment}</p>
      </div>

      <div className="fm-rating-summary">
        {RATING_FIELDS.slice(1).map(([field, label]) => (
          <div key={field}>
            <span>{label}</span>
            <Stars value={record[field]} />
          </div>
        ))}
      </div>

      {error && <p className="fm-error" role="alert">{error}</p>}

      {conflict && (
        <p className="fm-muted">
          Close this form and refresh the list to load the latest version
          before editing again.
        </p>
      )}

      <form onSubmit={save}>
        <fieldset disabled={busy || conflict}>
          <label>
            Review status
            <select
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value })
              }
            >
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>

          <div className="fm-grid">
            <label>
              Management response
              <textarea
                rows={5}
                maxLength={3000}
                value={form.managementResponse}
                placeholder="Write a response for the guest..."
                onChange={(e) =>
                  setForm({
                    ...form,
                    managementResponse: e.target.value,
                  })
                }
              />
              <small className="fm-muted">
                Saved with the feedback and visible through the guest API.
                No email is sent.
              </small>
            </label>

            <label>
              Internal notes
              <textarea
                rows={5}
                maxLength={3000}
                value={form.internalNotes}
                placeholder="Follow-up actions and internal observations..."
                onChange={(e) =>
                  setForm({
                    ...form,
                    internalNotes: e.target.value,
                  })
                }
              />
              <small className="fm-muted">
                Internal notes are hidden from guest responses.
              </small>
            </label>
          </div>

          <button type="submit">
            {busy ? "Saving..." : "Save changes"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}

export default function FeedbackManagement() {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showCreate, setShowCreate] = useState(false);
  const [reservationPage, setReservationPage] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const locked = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const stays = useList(
    `/api/reservations?status=checked_out&page=${reservationPage}&limit=20`,
    "reservations",
    refresh
  );

  const query = new URLSearchParams({
    page: String(page),
    limit: "10",
  });

  if (status) query.set("status", status);
  if (rating) query.set("rating", rating);

  const feedback = useList(
    `/api/feedback?${query.toString()}`,
    "feedback",
    refresh
  );

  function changeField(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function submitFeedback(event) {
    event.preventDefault();
    if (locked.current) return;

    setError("");
    setMessage("");

    if (!stays.items.some((stay) => stay._id === form.reservation)) {
      setError("Select a checked-out reservation.");
      return;
    }

    const title = form.title.trim();
    const comment = form.comment.trim();

    if (title.length < 3 || title.length > 150) {
      setError("Title must contain 3–150 characters.");
      return;
    }

    if (comment.length < 5 || comment.length > 3000) {
      setError("Comment must contain 5–3000 characters.");
      return;
    }

    const payload = {
      reservation: form.reservation,
      title,
      comment,
    };

    for (const [field] of RATING_FIELDS) {
      const value = form[field] === "" ? null : Number(form[field]);

      if (
        (field === "overallRating" && value === null) ||
        (value !== null &&
          (!Number.isInteger(value) || value < 1 || value > 5))
      ) {
        setError("Choose an overall rating and valid optional ratings.");
        return;
      }

      payload[field] = value;
    }

    locked.current = true;
    setBusy(true);

    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!mounted.current) return;

      setMessage("Guest feedback recorded successfully.");
      setForm({ ...EMPTY_FORM });
      setShowCreate(false);
      setPage(1);
      setStatus("");
      setRating("");
      setRefresh((value) => value + 1);
    } catch (err) {
      if (mounted.current) {
        setError(err.message || "Unable to submit feedback.");
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="fm-root">
      <style>{styles}</style>

      <header className="fm-heading">
        <div>
          <p className="fm-eyebrow">GUEST EXPERIENCE</p>
          <h1>Feedback & reviews</h1>
          <p className="fm-muted">
            Listen to guests, review their experience and track follow-up.
          </p>
        </div>

        {!selected && (
          <div className="fm-actions">
            <button
              type="button"
              className="fm-secondary"
              disabled={busy}
              onClick={() => setRefresh((value) => value + 1)}
            >
              Refresh
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setShowCreate((value) => !value)}
            >
              {showCreate ? "Hide form" : "+ Record feedback"}
            </button>
          </div>
        )}
      </header>

      {selected ? (
        <FeedbackEditor
          key={`${selected._id}-${selected.version}`}
          record={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            setMessage("Feedback updated successfully.");
            setRefresh((value) => value + 1);
          }}
        />
      ) : (
        <>
          {error && <p className="fm-error" role="alert">{error}</p>}
          {message && <p className="fm-success" role="status">{message}</p>}

          {showCreate && (
            <section className="fm-panel">
              <h2>Record guest feedback</h2>
              <p className="fm-muted">
                Enter feedback provided by the guest after check-out.
                It will be labelled as a staff-entered record.
                Each reservation can have one feedback record.
              </p>

              {stays.error && (
                <p className="fm-error" role="alert">{stays.error}</p>
              )}

              <form onSubmit={submitFeedback}>
                <fieldset disabled={busy || stays.loading || Boolean(stays.error)}>
                  <label>
                    Checked-out reservation
                    <select
                      required
                      value={form.reservation}
                      onChange={(e) =>
                        changeField("reservation", e.target.value)
                      }
                    >
                      <option value="">
                        {stays.loading ? "Loading bookings..." : "Select a booking"}
                      </option>

                      {stays.items.map((stay) => (
                        <option key={stay._id} value={stay._id}>
                          {stay.bookingReference} — {stay.guestName}
                          {stay.room?.roomNumber
                            ? ` — Room ${stay.room.roomNumber}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Pager
                    page={reservationPage}
                    pages={stays.pages}
                    disabled={busy || stays.loading}
                    onChange={(value) => {
                      changeField("reservation", "");
                      setReservationPage(value);
                    }}
                  />

                  {!stays.loading && !stays.error && stays.total === 0 && (
                    <p className="fm-empty">
                      No checked-out reservations are available yet.
                    </p>
                  )}

                  <div className="fm-rating-fields">
                    {RATING_FIELDS.map(([field, label]) => (
                      <label key={field}>
                        {label}{field === "overallRating" ? " *" : ""}
                        <select
                          required={field === "overallRating"}
                          value={form[field]}
                          onChange={(e) => changeField(field, e.target.value)}
                        >
                          <option value="">
                            {field === "overallRating" ? "Select rating" : "Not rated"}
                          </option>
                          <option value="1">1 — Poor</option>
                          <option value="2">2 — Fair</option>
                          <option value="3">3 — Good</option>
                          <option value="4">4 — Very good</option>
                          <option value="5">5 — Excellent</option>
                        </select>
                      </label>
                    ))}
                  </div>

                  <label>
                    Feedback title
                    <input
                      required
                      minLength={3}
                      maxLength={150}
                      value={form.title}
                      placeholder="A short summary of the guest's experience"
                      onChange={(e) => changeField("title", e.target.value)}
                    />
                  </label>

                  <label className="fm-spacing">
                    Guest comment
                    <textarea
                      required
                      rows={4}
                      minLength={5}
                      maxLength={3000}
                      value={form.comment}
                      placeholder="Enter the guest's feedback..."
                      onChange={(e) => changeField("comment", e.target.value)}
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={!form.reservation || !form.overallRating}
                  >
                    {busy ? "Saving..." : "Save guest feedback"}
                  </button>
                </fieldset>
              </form>
            </section>
          )}

          <section className="fm-panel">
            <div className="fm-heading">
              <div>
                <h2>Guest feedback</h2>
                <p className="fm-muted">
                  {feedback.total} matching record(s)
                </p>
              </div>

              <div className="fm-filters">
                <label>
                  Status
                  <select
                    value={status}
                    disabled={busy}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All statuses</option>
                    <option value="new">New</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </label>

                <label>
                  Overall rating
                  <select
                    value={rating}
                    disabled={busy}
                    onChange={(e) => {
                      setRating(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All ratings</option>
                    {[5, 4, 3, 2, 1].map((value) => (
                      <option key={value} value={value}>
                        {value} out of 5
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {feedback.error && (
              <p className="fm-error" role="alert">{feedback.error}</p>
            )}

            {feedback.loading ? (
              <p className="fm-empty">Loading feedback...</p>
            ) : !feedback.error && feedback.items.length === 0 ? (
              <p className="fm-empty">No feedback found for these filters.</p>
            ) : (
              <div className="fm-list">
                {feedback.items.map((record) => (
                  <article className="fm-review" key={record._id}>
                    <div className="fm-heading">
                      <div>
                        <Stars value={record.overallRating} />
                        <h3>{record.title}</h3>
                        <p className="fm-muted">
                          {record.guestName} · {record.bookingReference}
                        </p>
                      </div>

                      <span className={`fm-badge fm-${record.status}`}>
                        {record.status}
                      </span>
                    </div>

                    <p className="fm-preserve">{record.comment}</p>

                    <div className="fm-meta">
                      <span>{record.hotel?.name || "Hotel unavailable"}</span>
                      <span>Room {record.room?.roomNumber || "—"}</span>
                      <span>{formatDate(record.createdAt)}</span>
                      <span>
                        {record.source === "guest"
                          ? "Submitted by guest"
                          : "Entered by staff"}
                      </span>
                    </div>

                    <div className="fm-rating-summary">
                      {RATING_FIELDS.slice(1).map(([field, label]) => (
                        <div key={field}>
                          <span>{label}</span>
                          <strong>
                            {record[field] == null ? "Not rated" : `${record[field]}/5`}
                          </strong>
                        </div>
                      ))}
                    </div>

                    {record.managementResponse && (
                      <div className="fm-response">
                        <strong>Management response</strong>
                        <p className="fm-preserve">
                          {record.managementResponse}
                        </p>
                        <small>
                          {record.respondedBy?.name || "Management"} ·{" "}
                          {formatDate(record.respondedAt)}
                        </small>
                      </div>
                    )}

                    {record.internalNotes && (
                      <details className="fm-internal">
                        <summary>Internal notes</summary>
                        <p className="fm-preserve">{record.internalNotes}</p>
                      </details>
                    )}

                    <div className="fm-review-footer">
                      <small className="fm-muted">
                        {record.status === "resolved"
                          ? `Resolved: ${formatDate(record.resolvedAt)}`
                          : record.status === "reviewed"
                          ? `Reviewed: ${formatDate(record.reviewedAt)}`
                          : "Awaiting review"}
                      </small>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setError("");
                          setMessage("");
                          setSelected(record);
                        }}
                      >
                        Manage / Respond
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <Pager
              page={page}
              pages={feedback.pages}
              disabled={busy || feedback.loading}
              onChange={setPage}
            />
          </section>
        </>
      )}
    </div>
  );
}

const styles = `
.fm-root{font-family:inherit;color:#234337;min-width:0}
.fm-root *{box-sizing:border-box}
.fm-root h1{font-size:30px;letter-spacing:-.6px;margin:0 0 8px}
.fm-root h2{font-size:21px;margin:0 0 8px}
.fm-root h3{font-size:18px;margin:12px 0 5px;overflow-wrap:anywhere}
.fm-root p{line-height:1.7;margin:8px 0 16px}
.fm-heading{display:flex;align-items:center;justify-content:space-between;
  gap:18px;flex-wrap:wrap;margin-bottom:20px}
.fm-eyebrow{font-size:10px;letter-spacing:2px;font-weight:800;color:#94743e}
.fm-muted{font-size:13px;color:#718176}
.fm-panel{background:#fff;padding:25px;border:1px solid #e1e7dc;
  border-radius:18px;margin-bottom:24px}
.fm-actions,.fm-filters{display:flex;gap:12px;flex-wrap:wrap}
.fm-filters label{min-width:150px}
.fm-root button{border:1px solid #204e3b;background:#204e3b;color:white;
  padding:11px 17px;border-radius:9px;font:inherit;font-size:13px;
  font-weight:700;cursor:pointer}
.fm-root button:hover:not(:disabled){background:#30644d}
.fm-root button.fm-secondary{background:white;color:#284d39;border-color:#dce4d8}
.fm-root button.fm-secondary:hover:not(:disabled){background:#f3f6ee}
.fm-root button:disabled{opacity:.5;cursor:not-allowed}
.fm-root button:focus-visible,.fm-root input:focus-visible,
.fm-root textarea:focus-visible,.fm-root select:focus-visible{
  outline:3px solid #b8ccad;outline-offset:2px}
.fm-root fieldset{border:0;padding:0;margin:0;min-width:0}
.fm-root label{display:flex;flex-direction:column;gap:8px;
  font-size:13px;font-weight:700;min-width:0}
.fm-root input,.fm-root textarea,.fm-root select{
  width:100%;font:inherit;font-size:14px;color:#254534;
  padding:12px;border:1px solid #dce4d6;border-radius:9px;background:#fcfdf9}
.fm-root textarea{resize:vertical}
.fm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  gap:20px;margin:22px 0}
.fm-rating-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:16px;margin:22px 0}
.fm-spacing{margin:20px 0}
.fm-stars{display:inline-flex;align-items:center;gap:10px;color:#ac8138;
  font-size:21px;letter-spacing:2px}
.fm-stars strong{font-size:12px;letter-spacing:0;color:#526b52}
.fm-empty-stars{color:#e3e5da}
.fm-empty{padding:30px 18px;background:#f6f8f2;border:1px dashed #dce4d4;
  border-radius:12px;text-align:center;color:#7b8773}
.fm-error,.fm-success{padding:13px 16px;border-radius:10px;
  font-size:14px;overflow-wrap:anywhere}
.fm-error{background:#fff0ec;color:#9a4030;border:1px solid #f2d8cf}
.fm-success{background:#edf7ed;color:#2b6d39;border:1px solid #d5e8d0}
.fm-pagination{display:flex;justify-content:flex-end;align-items:center;
  gap:14px;margin-top:20px;color:#77846d;font-size:13px}
.fm-list{display:grid;gap:18px}
.fm-review{padding:22px;border:1px solid #e1e7da;border-radius:14px;background:#fff}
.fm-review .fm-heading{margin-bottom:12px}
.fm-badge{font-size:11px;font-weight:800;text-transform:capitalize;
  border-radius:20px;padding:7px 12px}
.fm-new{color:#96742e;background:#fff5d9}
.fm-reviewed{color:#416c8a;background:#edf4f9}
.fm-resolved{color:#397143;background:#eaf5e8}
.fm-preserve{white-space:pre-wrap;overflow-wrap:anywhere}
.fm-meta{display:flex;flex-wrap:wrap;gap:9px 18px;color:#7c8776;font-size:12px;
  padding-bottom:16px;border-bottom:1px solid #edf0e8}
.fm-rating-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  gap:12px;margin:18px 0}
.fm-rating-summary>div{background:#f7f9f3;padding:12px;border-radius:8px}
.fm-rating-summary>div>span:first-child{display:block;color:#7b856e;
  font-size:11px;margin-bottom:7px}
.fm-rating-summary strong{font-size:12px}
.fm-rating-summary .fm-stars{font-size:15px;letter-spacing:0;flex-wrap:wrap}
.fm-response{padding:16px 18px;background:#f0f5eb;border-left:3px solid #85a36c;
  border-radius:8px;margin-top:16px;font-size:13px}
.fm-response small{color:#77866e}
.fm-response p{margin-bottom:8px}
.fm-internal{margin-top:16px;font-size:13px;color:#68765f}
.fm-internal summary{cursor:pointer;font-weight:700}
.fm-review-footer{display:flex;align-items:center;justify-content:space-between;
  flex-wrap:wrap;gap:14px;margin-top:20px}
.fm-quote{background:#f8f9f4;border:1px solid #e4e8dd;
  border-radius:12px;padding:20px;margin-bottom:20px}
@media(max-width:850px){
  .fm-rating-fields{grid-template-columns:repeat(2,minmax(0,1fr))}
  .fm-rating-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:560px){
  .fm-panel,.fm-review{padding:17px}
  .fm-root h1{font-size:25px}
  .fm-grid,.fm-rating-fields{grid-template-columns:1fr}
  .fm-filters{width:100%}
  .fm-filters label{flex:1;min-width:120px}
  .fm-pagination{justify-content:center;gap:9px;flex-wrap:wrap}
}
`;