# AI Credit Exchange Calculator

A full-stack web application that estimates the exchange value between AI service credits — starting with **OpenAI Credits (OAI)** and **Perplexity Credits (PPX)**. The interface mirrors a traditional fiat currency exchange calculator, with a dark retro-futuristic design, animated rate ticker, and graceful offline fallback.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (Browser)                  │
│  index.html  ←→  styles.css  ←→  script.js             │
│                                                         │
│  • Currency selector dropdowns                          │
│  • Amount input + converted output                      │
│  • Swap button with animation                           │
│  • Result panel with rate details                       │
│  • Connection status indicator                          │
│  • Offline fallback (client-side calculation)           │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP (fetch API)
                         │ POST /api/convert
                         │ GET  /api/rates
                         │ GET  /api/health
┌────────────────────────▼────────────────────────────────┐
│                  BACKEND (Flask / Python)                │
│  app.py                                                 │
│                                                         │
│  • /api/convert  — Performs credit conversion           │
│  • /api/rates    — Returns all exchange rates           │
│  • /api/health   — Health check endpoint                │
│                                                         │
│  Exchange logic: Decimal arithmetic (no float errors)   │
│  CORS: Enabled for all origins (local dev)              │
└─────────────────────────────────────────────────────────┘
```

---

## Placeholder Exchange Rates

These rates are **configurable** — edit the `EXCHANGE_RATES` dict in `app.py` to change them at any time without touching any other code.

| From | To | Rate |
|------|----|------|
| 1 OpenAI Credit (OAI) | Perplexity Credits (PPX) | **1.8500** |
| 1 Perplexity Credit (PPX) | OpenAI Credits (OAI) | **0.5405** |

> These are demonstration values only. They do not reflect any real market rate.

**To update rates**, open `app.py` and edit:

```python
EXCHANGE_RATES = {
    "openai": {
        "openai":     Decimal("1.0"),
        "perplexity": Decimal("1.85"),   # ← Change this
    },
    "perplexity": {
        "perplexity": Decimal("1.0"),
        "openai":     Decimal("0.5405"), # ← Change this
    },
}
```

---

## Setup & Installation

### Prerequisites

- Python 3.8 or higher
- pip

### Step 1 — Clone / navigate to the project folder

```bash
cd ai_credit_calculator
```

### Step 2 — Install Python dependencies

```bash
pip install flask flask-cors
```

Or using a virtual environment (recommended):

```bash
python -m venv venv
source venv/bin/activate        # macOS/Linux
venv\Scripts\activate           # Windows
pip install flask flask-cors
```

### Step 3 — Start the Flask backend

```bash
python app.py
```

You should see:

```
=======================================================
  AI Credit Exchange Calculator — Backend API
=======================================================
  Running at: http://localhost:5000
  Endpoints:
    POST /api/convert  — Convert credits
    GET  /api/rates    — Get all rates
    GET  /api/health   — Health check
=======================================================
  Placeholder Exchange Rates:
    1 OAI  = 1.8500 PPX
    1 PPX  = 0.5405 OAI
=======================================================
```

### Step 4 — Open the frontend

Open `index.html` in your browser. You can do this by:

**Option A — Direct file open:**
```
Double-click index.html
```
or
```
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux
```

**Option B — Serve via Python (avoids any CORS edge cases):**
```bash
python -m http.server 8080
```
Then visit: `http://localhost:8080`

---

## Using the Calculator

### Basic Conversion

1. **Enter an amount** in the "You Send" field (e.g., `100`)
2. **Select source credit type** from the left dropdown (OAI or PPX)
3. **Select target credit type** from the right dropdown (OAI or PPX)
4. **Click "Calculate Exchange"** or press **Enter**
5. The converted amount appears in "You Receive" and the result panel shows full rate details

### Swap Currencies

Click the **⇄ swap button** between the two fields to instantly reverse the conversion direction. If a result is already shown, the converted amount is carried over as the new input.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Trigger conversion |
| `Tab` | Navigate between fields |
| `Enter` / `Space` | Open/select dropdown options |
| `Escape` | Close dropdown |

### Offline Mode

If the Flask backend is not running, the calculator automatically falls back to **client-side calculation** using the same placeholder rates. The status indicator in the header will show "Offline — using local rates" in red. All conversions still work correctly.

---

## API Reference

### `POST /api/convert`

Convert between credit types.

**Request body:**
```json
{
  "amount": 100,
  "from_currency": "openai",
  "to_currency": "perplexity"
}
```

**Supported currency values:** `openai`, `oai`, `perplexity`, `ppx`

**Response:**
```json
{
  "success": true,
  "amount": 100.0,
  "from_currency": "openai",
  "from_name": "OpenAI Credit",
  "from_symbol": "OAI",
  "to_currency": "perplexity",
  "to_name": "Perplexity Credit",
  "to_symbol": "PPX",
  "converted_amount": 185.0,
  "rate": 1.85,
  "rate_display": "1 OAI = 1.8500 PPX",
  "inverse_rate": 0.5405,
  "inverse_rate_display": "1 PPX = 0.5405 OAI",
  "timestamp": 1746000000
}
```

### `GET /api/rates`

Returns all current exchange rates and credit metadata.

### `GET /api/health`

Returns `{"status": "ok"}` — used by the frontend to detect backend availability.

---

## Test the API with curl

```bash
# Convert 250 OAI → PPX
curl -X POST http://localhost:5000/api/convert \
  -H "Content-Type: application/json" \
  -d '{"amount": 250, "from_currency": "openai", "to_currency": "perplexity"}'

# Convert 500 PPX → OAI
curl -X POST http://localhost:5000/api/convert \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "from_currency": "perplexity", "to_currency": "openai"}'

# Get all rates
curl http://localhost:5000/api/rates

# Health check
curl http://localhost:5000/api/health
```

---

## File Structure

```
ai_credit_calculator/
├── app.py          # Flask backend — exchange rate logic & API endpoints
├── index.html      # Frontend markup — semantic HTML5
├── styles.css      # Design system — Volcanic Glass dark theme
├── script.js       # Frontend logic — API calls, UI interactions, fallback
└── README.md       # This file
```

---

## Adding More Credit Types

To add a new credit type (e.g., Anthropic Claude Credits):

**1. In `app.py`**, add to `EXCHANGE_RATES` and `CREDIT_META`:
```python
EXCHANGE_RATES = {
    "openai":     { ..., "anthropic": Decimal("2.10") },
    "perplexity": { ..., "anthropic": Decimal("1.15") },
    "anthropic":  { "anthropic": Decimal("1.0"), "openai": Decimal("0.476"), "perplexity": Decimal("0.869") },
}

CREDIT_META["anthropic"] = {
    "name": "Anthropic Credit",
    "symbol": "ANT",
    "color": "#D97706",
    "description": "Anthropic Claude API usage credits",
}
```

**2. In `script.js`**, add to `FALLBACK_RATES`, `CREDIT_META`, and add a new logo SVG.

**3. In `index.html`**, add a new `<div class="dropdown-option">` to both dropdowns.

---

## Disclaimer

This calculator uses **placeholder exchange rates for demonstration purposes only**. It is not affiliated with OpenAI, Perplexity AI, or any other AI provider. The rates shown do not reflect any real market value. This is not financial advice.