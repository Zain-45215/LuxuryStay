import { useEffect, useRef, useState } from "react";

const API = "/api/billing";

async function api(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Connection failed. Please try again.");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok || data?.success !== true) {
    const error = new Error(
      response.status === 401
        ? "Your session expired. Please log in again."
        : response.status === 403
        ? "You do not have access to billing."
        : data?.message || "The request could not be completed."
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

function readList(data, field) {
  const items = data[field];
  const pagination = data.pagination;

  if (
    !Array.isArray(items) ||
    !pagination ||
    !Number.isSafeInteger(pagination.total) ||
    pagination.total < 0 ||
    !Number.isSafeInteger(pagination.pages) ||
    pagination.pages < 0 ||
    (pagination.pages === 0 && pagination.total !== 0)
  ) {
    throw new Error("The server returned an invalid list.");
  }

  return {
    items,
    total: pagination.total,
    pages: Math.max(1, pagination.pages),
  };
}

function useList(url, field, refresh) {
  const key = `${url}|${refresh}`;
  const [state, setState] = useState({
    key: "",
    items: [],
    total: 0,
    pages: 1,
    loading: true,
    error: "",
  });

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

    api(url, { signal: controller.signal })
      .then((data) => {
        const list = readList(data, field);

        if (!controller.signal.aborted) {
          setState({ key, ...list, loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            key,
            items: [],
            total: 0,
            pages: 1,
            loading: false,
            error: error.message,
          });
        }
      });

    return () => controller.abort();
  }, [url, field, refresh, key]);

  return state.key === key
    ? state
    : { items: [], total: 0, pages: 1, loading: true, error: "" };
}

function decimal(minor) {
  if (!Number.isSafeInteger(minor) || minor < 0) return "—";

  const value = BigInt(minor);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function money(minor, currency) {
  return `${currency || ""} ${decimal(minor)}`;
}

function parseAmount(text) {
  const value = text.trim();

  if (!/^\d{1,14}(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Enter an amount with no more than two decimal places.");
  }

  const [whole, fraction = ""] = value.split(".");
  const minor =
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));

  if (minor < 1n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Enter a valid positive payment amount.");
  }

  return Number(minor);
}

function dateTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  });
}

function statusLabel(value) {
  return String(value || "").replaceAll("_", " ");
}

function Pager({ page, pages, onChange, disabled }) {
  return (
    <div className="bm-pagination">
      <button
        type="button"
        className="bm-secondary"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>

      <span>
        Page {page} of {pages}
      </span>

      <button
        type="button"
        className="bm-secondary"
        disabled={disabled || page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

function InvoiceDetails({ id, onClose, onChanged }) {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [paymentPage, setPaymentPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(null);
  const [form, setForm] = useState({
    amount: "",
    method: "cash",
    reference: "",
    notes: "",
  });

  const mounted = useRef(false);
  const locked = useRef(false);
  const printRef = useRef(null);
  const storageKey = `luxurystay-payment-${id}`;

  const history = useList(
    `${API}/invoices/${id}/payments?page=${paymentPage}&limit=10`,
    "payments",
    refresh
  );

  useEffect(() => {
    mounted.current = true;

    try {
      const saved = sessionStorage.getItem(storageKey);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (
          Number.isSafeInteger(parsed.amountMinor) &&
          parsed.amountMinor > 0 &&
          typeof parsed.idempotencyKey === "string" &&
          ["cash", "card", "bank_transfer"].includes(parsed.method)
        ) {
          setAttempt(parsed);
          setForm({
            amount: decimal(parsed.amountMinor),
            method: parsed.method,
            reference: parsed.reference || "",
            notes: parsed.notes || "",
          });
          setMessage(
            "An unfinished payment request was found. Retry it to confirm its result."
          );
        }
      }
    } catch {
      setError("Browser storage is unavailable. Enable it before recording payments.");
    }

    return () => {
      mounted.current = false;
    };
  }, [storageKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    api(`${API}/invoices/${id}`, { signal: controller.signal })
      .then((data) => {
        if (!data.invoice || !Array.isArray(data.invoice.items)) {
          throw new Error("The server returned an invalid invoice.");
        }

        if (!controller.signal.aborted) {
          setInvoice(data.invoice);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [id, refresh]);

  async function recordPayment(event) {
    event.preventDefault();
    if (locked.current || !invoice) return;

    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    let payload = attempt;

    try {
      if (!payload) {
        const amountMinor = parseAmount(form.amount);

        if (amountMinor > invoice.balanceMinor) {
          throw new Error("Payment cannot exceed the remaining balance.");
        }

        payload = {
          amountMinor,
          method: form.method,
          reference: form.reference.trim(),
          notes: form.notes.trim(),
          idempotencyKey: crypto.randomUUID(),
        };

        // Save before sending so a connection failure can be retried safely.
        sessionStorage.setItem(storageKey, JSON.stringify(payload));
        setAttempt(payload);
      }

      const result = await api(`${API}/invoices/${id}/payments`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Retrying the stored key still cannot record the payment twice.
      }

      if (!mounted.current) return;

      setAttempt(null);
      setInvoice(result.invoice);
      setForm({
        amount: "",
        method: "cash",
        reference: "",
        notes: "",
      });
      setMessage(result.message || "Payment recorded.");
      setPaymentPage(1);
      setRefresh((value) => value + 1);
      onChanged();
    } catch (err) {
      if (!mounted.current) return;

      // A definite client error means this request was rejected.
      // Connection/server errors retain the same key and payload for retry.
      if (err.status >= 400 && err.status < 500) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          // The next attempt will replace the saved request.
        }
        setAttempt(null);
      }

      setError(err.message);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function printInvoice() {
    if (!printRef.current || !invoice) return;

    const popup = window.open("", "_blank", "width=950,height=800");

    if (!popup) {
      setError("Allow pop-ups to open the printable invoice.");
      return;
    }

    const doc = popup.document;
    doc.title = invoice.invoiceNumber;

    const style = doc.createElement("style");
    style.textContent = `
      body{font:14px Arial,sans-serif;color:#172b25;padding:32px}
      h2{margin:0 0 10px}p{line-height:1.6}
      .bm-invoice-head,.bm-grid,.bm-totals{
        display:flex;justify-content:space-between;gap:25px;flex-wrap:wrap
      }
      .bm-invoice-head{border-bottom:2px solid #173f35;padding-bottom:20px}
      .bm-grid{margin:24px 0}
      .bm-grid>div{flex:1;min-width:200px}
      table{width:100%;border-collapse:collapse;margin:24px 0}
      th,td{padding:12px 8px;border-bottom:1px solid #ddd;text-align:left}
      th{background:#f2f5f3}td{overflow-wrap:anywhere}
      .bm-totals{border-top:2px solid #173f35;padding-top:20px}
      .bm-totals div{min-width:120px}
      .bm-totals strong{display:block;margin-top:8px}
      .bm-muted{color:#64756e}.bm-badge{text-transform:capitalize}
      .bm-invoice-number{overflow-wrap:anywhere;max-width:320px}
      .bm-notes{white-space:pre-wrap}
      button{padding:10px 18px;margin-bottom:25px;cursor:pointer}
      @media print{body{padding:0}button{display:none}
        thead{display:table-header-group}tr{break-inside:avoid}}
    `;
    doc.head.appendChild(style);

    const button = doc.createElement("button");
    button.textContent = "Print / Save as PDF";
    button.onclick = () => popup.print();

    doc.body.appendChild(button);
    doc.body.appendChild(doc.importNode(printRef.current, true));
    popup.focus();
  }

  return (
    <section className="bm-card">
      <div className="bm-heading">
        <div>
          <h2>Invoice details</h2>
          <p className="bm-muted">Charges, payments and printable invoice.</p>
        </div>

        <div className="bm-actions">
          <button
            type="button"
            disabled={busy || loading || !invoice}
            onClick={printInvoice}
          >
            Print / Save PDF
          </button>

          <button
            type="button"
            className="bm-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      {error && <p className="bm-error" role="alert">{error}</p>}
      {message && <p className="bm-success" role="status">{message}</p>}
      {loading && <p className="bm-muted">Loading invoice...</p>}

      {!loading && !invoice && (
        <button type="button" onClick={() => setRefresh((n) => n + 1)}>
          Retry
        </button>
      )}

      {invoice && (
        <>
          <div className="bm-paper" ref={printRef}>
            <div className="bm-invoice-head">
              <div>
                <p className="bm-eyebrow">LUXURYSTAY HOSPITALITY</p>
                <h2>{invoice.hotelName}</h2>
                <p>{invoice.hotelAddress}</p>
                <p>{invoice.hotelPhone}</p>
              </div>

              <div>
                <h2>INVOICE</h2>
                <p className="bm-invoice-number">{invoice.invoiceNumber}</p>
                <p>Issued: {dateTime(invoice.issuedAt)}</p>
                <span className={`bm-badge bm-${invoice.status}`}>
                  {statusLabel(invoice.status)}
                </span>
              </div>
            </div>

            <div className="bm-grid">
              <div>
                <h3>Bill to</h3>
                <p>
                  <strong>{invoice.guestName}</strong><br />
                  {invoice.guestEmail}<br />
                  {invoice.guestPhone}
                </p>
              </div>

              <div>
                <h3>Stay details</h3>
                <p>
                  Booking: {invoice.bookingReference}<br />
                  Room: {invoice.roomNumber}<br />
                  Arrival: {invoice.checkInDate}<br />
                  Departure: {invoice.checkOutDate}
                </p>
              </div>
            </div>

            <div className="bm-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Subtotal</th>
                    <th>Tax</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item, index) => (
                    <tr key={item.serviceRequest || `room-${index}`}>
                      <td>{item.description}</td>
                      <td>{item.quantity}</td>
                      <td>{money(item.subtotalMinor, invoice.currency)}</td>
                      <td>
                        {money(item.taxAmountMinor, invoice.currency)}
                        <br />
                        <small>{item.taxRateBps / 100}%</small>
                      </td>
                      <td>{money(item.totalMinor, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bm-totals">
              <div>Subtotal<strong>{money(invoice.subtotalMinor, invoice.currency)}</strong></div>
              <div>Tax<strong>{money(invoice.taxAmountMinor, invoice.currency)}</strong></div>
              <div>Total<strong>{money(invoice.totalMinor, invoice.currency)}</strong></div>
              <div>Paid<strong>{money(invoice.paidMinor, invoice.currency)}</strong></div>
              <div>Balance<strong>{money(invoice.balanceMinor, invoice.currency)}</strong></div>
            </div>

            {invoice.notes && (
              <p className="bm-notes"><strong>Notes:</strong> {invoice.notes}</p>
            )}
          </div>

          {(invoice.balanceMinor > 0 || attempt) && (
            <form className="bm-payment" onSubmit={recordPayment}>
              <h3>Record received payment</h3>
              <p className="bm-muted">
                Enter money already received. This form does not charge a card.
              </p>

              {attempt && (
                <p className="bm-warning">
                  A payment request is awaiting confirmation. Retry the same
                  request before entering another payment.
                </p>
              )}

              <fieldset disabled={busy || loading || Boolean(attempt)}>
                <div className="bm-form-grid">
                  <label>
                    Amount ({invoice.currency})
                    <input
                      required
                      inputMode="decimal"
                      placeholder="1500.00"
                      value={form.amount}
                      onChange={(e) =>
                        setForm({ ...form, amount: e.target.value })
                      }
                    />
                  </label>

                  <label>
                    Payment method
                    <select
                      value={form.method}
                      onChange={(e) =>
                        setForm({ ...form, method: e.target.value })
                      }
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </select>
                  </label>

                  <label>
                    Transaction / receipt reference
                    <input
                      maxLength={150}
                      value={form.reference}
                      onChange={(e) =>
                        setForm({ ...form, reference: e.target.value })
                      }
                    />
                  </label>

                  <label>
                    Payment notes
                    <input
                      maxLength={1000}
                      value={form.notes}
                      onChange={(e) =>
                        setForm({ ...form, notes: e.target.value })
                      }
                    />
                  </label>
                </div>
              </fieldset>

              <button type="submit" disabled={busy || loading}>
                {busy
                  ? "Saving..."
                  : attempt
                  ? "Retry payment request"
                  : "Record payment"}
              </button>
            </form>
          )}

          <div className="bm-history">
            <div className="bm-heading">
              <h3>Payment history</h3>
              <button
                type="button"
                className="bm-secondary"
                disabled={busy || history.loading}
                onClick={() => setRefresh((n) => n + 1)}
              >
                Refresh
              </button>
            </div>

            {history.error && (
              <p className="bm-error" role="alert">{history.error}</p>
            )}

            {history.loading ? (
              <p className="bm-muted">Loading payments...</p>
            ) : !history.error && history.items.length === 0 ? (
              <p className="bm-empty">No payments recorded yet.</p>
            ) : (
              <div className="bm-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Date</th>
                      <th>Method / reference</th>
                      <th>Amount</th>
                      <th>Recorded by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.items.map((payment) => (
                      <tr key={payment._id}>
                        <td className="bm-break">{payment.receiptNumber}</td>
                        <td>{dateTime(payment.receivedAt)}</td>
                        <td>
                          {statusLabel(payment.method)}
                          <br />
                          <small>{payment.reference || "—"}</small>
                          {payment.notes && <p>{payment.notes}</p>}
                        </td>
                        <td>{money(payment.amountMinor, payment.currency)}</td>
                        <td>{payment.recordedBy?.name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Pager
              page={paymentPage}
              pages={history.pages}
              onChange={setPaymentPage}
              disabled={busy || history.loading}
            />
          </div>
        </>
      )}
    </section>
  );
}

export default function BillingManagement() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [reservationPage, setReservationPage] = useState(1);
  const [reservation, setReservation] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const mounted = useRef(false);
  const locked = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const invoices = useList(
    `${API}/invoices?page=${page}&limit=10${status ? `&status=${status}` : ""}`,
    "invoices",
    refresh
  );

  const stays = useList(
    `/api/reservations?status=checked_out&page=${reservationPage}&limit=20`,
    "reservations",
    refresh
  );

  async function createInvoice(event) {
    event.preventDefault();
    if (locked.current) return;

    if (!stays.items.some((stay) => stay._id === reservation)) {
      setError("Select a checked-out reservation.");
      return;
    }

    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const data = await api(`${API}/invoices`, {
        method: "POST",
        body: JSON.stringify({
          reservation,
          notes: notes.trim(),
        }),
      });

      if (!mounted.current) return;

      setMessage(data.message || "Invoice created.");
      setSelectedInvoice(data.invoice._id);
      setReservation("");
      setNotes("");
      setPage(1);
      setStatus("");
      setRefresh((value) => value + 1);
    } catch (err) {
      if (mounted.current) setError(err.message);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="bm-root">
      <style>{styles}</style>

      <header className="bm-heading">
        <div>
          <p className="bm-eyebrow">LUXURYSTAY FINANCE</p>
          <h1>Billing & invoices</h1>
          <p className="bm-muted">
            Create final invoices and keep track of guest payments.
          </p>
        </div>

        {!selectedInvoice && (
          <button
            type="button"
            className="bm-secondary"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh
          </button>
        )}
      </header>

      {selectedInvoice ? (
        <InvoiceDetails
          key={selectedInvoice}
          id={selectedInvoice}
          onClose={() => {
            setSelectedInvoice("");
            setRefresh((value) => value + 1);
          }}
          onChanged={() => setRefresh((value) => value + 1)}
        />
      ) : (
        <>
          {error && <p className="bm-error" role="alert">{error}</p>}
          {message && <p className="bm-success" role="status">{message}</p>}

          <section className="bm-card">
            <h2>Create final invoice</h2>
            <p className="bm-muted">
              Select a checked-out booking. Complete or cancel its pending
              services first. Existing invoices will open without duplication.
            </p>

            {stays.error && (
              <p className="bm-error" role="alert">{stays.error}</p>
            )}

            <form onSubmit={createInvoice}>
              <fieldset disabled={busy || stays.loading || Boolean(stays.error)}>
                <div className="bm-form-grid">
                  <label>
                    Checked-out reservation
                    <select
                      required
                      value={reservation}
                      onChange={(e) => setReservation(e.target.value)}
                    >
                      <option value="">
                        {stays.loading ? "Loading reservations..." : "Select a booking"}
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

                  <label>
                    Invoice notes (optional)
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </label>
                </div>
              </fieldset>

              {!stays.loading && !stays.error && stays.total === 0 && (
                <p className="bm-empty">
                  No checked-out reservations yet. Check out a guest from
                  the Check-in / Check-out page first.
                </p>
              )}

              <div className="bm-heading">
                <button
                  type="submit"
                  disabled={busy || stays.loading || !reservation || Boolean(stays.error)}
                >
                  {busy ? "Creating..." : "Create / Open invoice"}
                </button>

                <Pager
                  page={reservationPage}
                  pages={stays.pages}
                  disabled={busy || stays.loading}
                  onChange={(value) => {
                    setReservation("");
                    setReservationPage(value);
                  }}
                />
              </div>
            </form>
          </section>

          <section className="bm-card">
            <div className="bm-heading">
              <div>
                <h2>Invoices</h2>
                <p className="bm-muted">{invoices.total} matching invoice(s)</p>
              </div>

              <label className="bm-filter">
                Payment status
                <select
                  value={status}
                  disabled={busy}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="partially_paid">Partially paid</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
            </div>

            {invoices.error && (
              <p className="bm-error" role="alert">{invoices.error}</p>
            )}

            {invoices.loading ? (
              <p className="bm-empty">Loading invoices...</p>
            ) : !invoices.error && invoices.items.length === 0 ? (
              <p className="bm-empty">No invoices found.</p>
            ) : (
              <div className="bm-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice / booking</th>
                      <th>Guest / hotel</th>
                      <th>Total</th>
                      <th>Balance</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.items.map((invoice) => (
                      <tr key={invoice._id}>
                        <td className="bm-break">
                          <strong>{invoice.invoiceNumber}</strong><br />
                          <small>{invoice.bookingReference}</small>
                        </td>
                        <td>
                          <strong>{invoice.guestName}</strong><br />
                          <small>
                            {invoice.hotelName} · Room {invoice.roomNumber}
                          </small>
                        </td>
                        <td>{money(invoice.totalMinor, invoice.currency)}</td>
                        <td>{money(invoice.balanceMinor, invoice.currency)}</td>
                        <td>
                          <span className={`bm-badge bm-${invoice.status}`}>
                            {statusLabel(invoice.status)}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setSelectedInvoice(invoice._id)}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Pager
              page={page}
              pages={invoices.pages}
              onChange={setPage}
              disabled={busy || invoices.loading}
            />
          </section>
        </>
      )}
    </div>
  );
}

const styles = `
.bm-root{color:#193e34;font-family:inherit;min-width:0}
.bm-root *{box-sizing:border-box}
.bm-root h1{font-size:30px;margin:0 0 8px;letter-spacing:-.7px}
.bm-root h2{font-size:21px;margin:0 0 8px}
.bm-root h3{font-size:17px;margin:0 0 10px}
.bm-root p{line-height:1.6;margin:8px 0 14px}
.bm-heading{display:flex;justify-content:space-between;align-items:center;
  gap:18px;flex-wrap:wrap;margin-bottom:20px}
.bm-eyebrow{font-size:11px;font-weight:800;letter-spacing:2px;color:#947337}
.bm-muted{color:#708078;font-size:14px}
.bm-card{background:#fff;border:1px solid #e0e7e1;border-radius:20px;
  padding:25px;margin-bottom:24px;box-shadow:0 6px 24px #173f3506}
.bm-root button{background:#194c3e;color:white;border:1px solid #194c3e;
  border-radius:10px;padding:11px 17px;font:inherit;font-size:13px;
  font-weight:700;cursor:pointer;transition:background .18s}
.bm-root button:hover:not(:disabled){background:#28644f}
.bm-root button.bm-secondary{background:#fff;color:#194c3e;border-color:#d9e3dc}
.bm-root button.bm-secondary:hover:not(:disabled){background:#f0f5f1}
.bm-root button:disabled{opacity:.5;cursor:not-allowed}
.bm-root button:focus-visible,.bm-root input:focus-visible,
.bm-root select:focus-visible,.bm-root textarea:focus-visible{
  outline:3px solid #b6d2c3;outline-offset:2px}
.bm-root fieldset{border:0;padding:0;margin:0;min-width:0}
.bm-root label{display:flex;flex-direction:column;gap:8px;
  font-size:13px;font-weight:700;min-width:0}
.bm-root input,.bm-root select,.bm-root textarea{
  width:100%;padding:12px;border:1px solid #dce4de;border-radius:10px;
  background:#fbfcfa;color:#233f34;font:inherit;font-size:14px}
.bm-root textarea{resize:vertical}
.bm-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  gap:18px;margin:20px 0}
.bm-actions{display:flex;flex-wrap:wrap;gap:10px}
.bm-filter{min-width:190px}
.bm-error,.bm-success,.bm-warning{padding:13px 16px;border-radius:10px;
  overflow-wrap:anywhere;font-size:14px}
.bm-error{background:#fff0ee;color:#a1382f;border:1px solid #f2d5d0}
.bm-success{background:#edf7ef;color:#23683b;border:1px solid #d0e7d5}
.bm-warning{background:#fff8e8;color:#876622;border:1px solid #eee0b6}
.bm-empty{padding:30px 16px;text-align:center;background:#f7f9f6;
  border:1px dashed #dbe4dc;border-radius:12px;color:#708078}
.bm-table-wrap{overflow:auto;width:100%}
.bm-root table{width:100%;border-collapse:collapse;font-size:13px}
.bm-root th{background:#f4f7f3;color:#6d7d72;font-size:11px;
  text-transform:uppercase;letter-spacing:.6px;white-space:nowrap}
.bm-root th,.bm-root td{text-align:left;padding:15px 12px;
  border-bottom:1px solid #e9eee9;vertical-align:top}
.bm-root td{line-height:1.6}
.bm-root td small{color:#758077}
.bm-break{overflow-wrap:anywhere;min-width:150px;max-width:230px}
.bm-badge{display:inline-block;padding:5px 10px;border-radius:20px;
  font-size:11px;font-weight:800;text-transform:capitalize;white-space:nowrap}
.bm-unpaid{background:#fff0e7;color:#a65d27}
.bm-partially_paid{background:#fff7d9;color:#887022}
.bm-paid{background:#e7f5eb;color:#287744}
.bm-pagination{display:flex;gap:14px;align-items:center;
  justify-content:flex-end;margin-top:18px;font-size:13px;color:#738076}
.bm-heading .bm-pagination{margin-top:0}
.bm-paper{padding:26px;border:1px solid #e1e7df;border-radius:12px;
  margin:20px 0;background:#fff}
.bm-invoice-head{display:flex;justify-content:space-between;gap:25px;
  flex-wrap:wrap;border-bottom:2px solid #204e3f;padding-bottom:20px}
.bm-invoice-number{overflow-wrap:anywhere;max-width:320px;font-size:13px}
.bm-grid{display:grid;grid-template-columns:1fr 1fr;gap:25px;margin:25px 0}
.bm-totals{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));
  gap:16px;border-top:2px solid #204e3f;padding-top:20px;margin-top:24px;
  color:#6d7d72;font-size:12px}
.bm-totals strong{display:block;margin-top:8px;color:#193e34;
  font-size:15px;overflow-wrap:anywhere}
.bm-notes{white-space:pre-wrap;overflow-wrap:anywhere}
.bm-payment{padding:22px;background:#f6f8f3;border:1px solid #e1e7dc;
  border-radius:14px;margin:24px 0}
.bm-history{margin-top:28px}
@media(max-width:800px){
  .bm-totals{grid-template-columns:repeat(2,minmax(0,1fr))}
  .bm-card{padding:18px}
  .bm-paper{padding:16px}
}
@media(max-width:560px){
  .bm-form-grid,.bm-grid{grid-template-columns:1fr}
  .bm-root h1{font-size:25px}
  .bm-pagination{justify-content:center;gap:9px;flex-wrap:wrap}
  .bm-filter{width:100%}
  .bm-card{padding:15px;border-radius:14px}
}
`;