"""
AI Credit Exchange Calculator — Flask Backend v2.0
====================================================
New in v2.0:
  - Storage Vault: in-memory balances per AI platform (configurable)
  - GET  /api/vault/balances          — View all vault balances
  - GET  /api/vault/balance/<platform> — View single platform balance
  - POST /api/vault/deposit           — Deposit tokens into vault
  - POST /api/vault/withdraw          — Withdraw tokens from vault
  - POST /api/vault/exchange          — Exchange tokens between platforms (deducts + credits vault)
  - POST /api/vault/reset             — Reset vault to default demo balances
  - GET  /api/vault/history           — Transaction history (last 50)

Existing endpoints preserved:
  - POST /api/convert   — Estimate conversion (no vault interaction)
  - GET  /api/rates     — Exchange rates
  - GET  /api/health    — Health check
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
import time
import copy
import os

app = Flask(__name__, static_folder=os.path.dirname(os.path.abspath(__file__)))
CORS(app)

# ── Serve frontend ──────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(app.static_folder, filename)

# ─────────────────────────────────────────────────────────────────
#  CONFIGURABLE EXCHANGE RATES
#  Edit values here to change rates across the entire app.
# ─────────────────────────────────────────────────────────────────
EXCHANGE_RATES = {
    "openai": {
        "openai":       Decimal("1.0"),
        "perplexity":   Decimal("1.85"),    # 1 OAI → 1.85 PPX
        "claude":       Decimal("0.92"),    # 1 OAI → 0.92 CLD
        "gemini":       Decimal("1.10"),    # 1 OAI → 1.10 GEM
        "huggingface":  Decimal("2.40"),    # 1 OAI → 2.40 HGF
        "base44":       Decimal("3.15"),    # 1 OAI → 3.15 B44
        "claw":         Decimal("1.55"),    # 1 OAI → 1.55 CLW
    },
    "perplexity": {
        "perplexity":   Decimal("1.0"),
        "openai":       Decimal("0.5405"),  # 1 PPX → 0.5405 OAI
        "claude":       Decimal("0.4973"),  # 1 PPX → 0.4973 CLD
        "gemini":       Decimal("0.5946"),  # 1 PPX → 0.5946 GEM
        "huggingface":  Decimal("1.2973"),  # 1 PPX → 1.2973 HGF
        "base44":       Decimal("1.7027"),  # 1 PPX → 1.7027 B44
        "claw":         Decimal("0.8378"),  # 1 PPX → 0.8378 CLW
    },
    "claude": {
        "claude":       Decimal("1.0"),
        "openai":       Decimal("1.0870"),  # 1 CLD → 1.0870 OAI
        "perplexity":   Decimal("2.0109"),  # 1 CLD → 2.0109 PPX
        "gemini":       Decimal("1.1957"),  # 1 CLD → 1.1957 GEM
        "huggingface":  Decimal("2.6087"),  # 1 CLD → 2.6087 HGF
        "base44":       Decimal("3.4239"),  # 1 CLD → 3.4239 B44
        "claw":         Decimal("1.6848"),  # 1 CLD → 1.6848 CLW
    },
    "gemini": {
        "gemini":       Decimal("1.0"),
        "openai":       Decimal("0.9091"),  # 1 GEM → 0.9091 OAI
        "perplexity":   Decimal("1.6818"),  # 1 GEM → 1.6818 PPX
        "claude":       Decimal("0.8364"),  # 1 GEM → 0.8364 CLD
        "huggingface":  Decimal("2.1818"),  # 1 GEM → 2.1818 HGF
        "base44":       Decimal("2.8636"),  # 1 GEM → 2.8636 B44
        "claw":         Decimal("1.4091"),  # 1 GEM → 1.4091 CLW
    },
    "huggingface": {
        "huggingface":  Decimal("1.0"),
        "openai":       Decimal("0.4167"),  # 1 HGF → 0.4167 OAI
        "perplexity":   Decimal("0.7708"),  # 1 HGF → 0.7708 PPX
        "claude":       Decimal("0.3833"),  # 1 HGF → 0.3833 CLD
        "gemini":       Decimal("0.4583"),  # 1 HGF → 0.4583 GEM
        "base44":       Decimal("1.3125"),  # 1 HGF → 1.3125 B44
        "claw":         Decimal("0.6458"),  # 1 HGF → 0.6458 CLW
    },
    "base44": {
        "base44":       Decimal("1.0"),
        "openai":       Decimal("0.3175"),  # 1 B44 → 0.3175 OAI
        "perplexity":   Decimal("0.5873"),  # 1 B44 → 0.5873 PPX
        "claude":       Decimal("0.2921"),  # 1 B44 → 0.2921 CLD
        "gemini":       Decimal("0.3492"),  # 1 B44 → 0.3492 GEM
        "huggingface":  Decimal("0.7619"),  # 1 B44 → 0.7619 HGF
        "claw":         Decimal("0.4921"),  # 1 B44 → 0.4921 CLW
    },
    "claw": {
        "claw":         Decimal("1.0"),
        "openai":       Decimal("0.6452"),  # 1 CLW → 0.6452 OAI
        "perplexity":   Decimal("1.1935"),  # 1 CLW → 1.1935 PPX
        "claude":       Decimal("0.5935"),  # 1 CLW → 0.5935 CLD
        "gemini":       Decimal("0.7097"),  # 1 CLW → 0.7097 GEM
        "huggingface":  Decimal("1.5484"),  # 1 CLW → 1.5484 HGF
        "base44":       Decimal("2.0323"),  # 1 CLW → 2.0323 B44
    },
}

# ─────────────────────────────────────────────────────────────────
#  CREDIT METADATA
# ─────────────────────────────────────────────────────────────────
CREDIT_META = {
    "openai": {
        "name":        "OpenAI Credit",
        "symbol":      "OAI",
        "color":       "#10A37F",
        "description": "OpenAI API usage credits (GPT-4, DALL·E, Whisper)",
    },
    "perplexity": {
        "name":        "Perplexity Credit",
        "symbol":      "PPX",
        "color":       "#FF6B2B",
        "description": "Perplexity AI API usage credits (sonar models)",
    },
    "claude": {
        "name":        "Claude Credit",
        "symbol":      "CLD",
        "color":       "#D97706",
        "description": "Anthropic Claude API usage credits (Claude 3 family)",
    },
    "gemini": {
        "name":        "Gemini Credit",
        "symbol":      "GEM",
        "color":       "#4285F4",
        "description": "Google Gemini API usage credits (Gemini Pro, Ultra)",
    },
    "huggingface": {
        "name":        "Hugging Face Credit",
        "symbol":      "HGF",
        "color":       "#FFD21E",
        "description": "Hugging Face Inference API credits (open-source models)",
    },
    "base44": {
        "name":        "Base44 Credit",
        "symbol":      "B44",
        "color":       "#7C3AED",
        "description": "Base44 platform credits for AI app building",
    },
    "claw": {
        "name":        "Claw Credit",
        "symbol":      "CLW",
        "color":       "#EC4899",
        "description": "Claw AI platform usage credits",
    },
}

# ─────────────────────────────────────────────────────────────────
#  STORAGE VAULT — CONFIGURABLE DEMO BALANCES
#  Edit DEFAULT_VAULT_BALANCES to set starting balances.
#  The vault is in-memory; it resets on server restart or via
#  POST /api/vault/reset.
# ─────────────────────────────────────────────────────────────────
DEFAULT_VAULT_BALANCES = {
    "openai":       Decimal("5000.00"),   # Starting OAI balance
    "perplexity":   Decimal("9250.00"),   # Starting PPX balance
    "claude":       Decimal("4600.00"),   # Starting CLD balance
    "gemini":       Decimal("5500.00"),   # Starting GEM balance
    "huggingface":  Decimal("12000.00"),  # Starting HGF balance
    "base44":       Decimal("15750.00"),  # Starting B44 balance
    "claw":         Decimal("7750.00"),   # Starting CLW balance
}

# Live vault state (mutated by deposit/withdraw/exchange)
vault_balances = copy.deepcopy(DEFAULT_VAULT_BALANCES)

# Transaction history (capped at 200 entries)
transaction_history = []
MAX_HISTORY = 200


# ─────────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────────

def normalize_currency(value: str):
    """Normalize currency identifier to lowercase internal key."""
    mapping = {
        "openai":       "openai",
        "oai":          "openai",
        "perplexity":   "perplexity",
        "ppx":          "perplexity",
        "claude":       "claude",
        "cld":          "claude",
        "anthropic":    "claude",
        "gemini":       "gemini",
        "gem":          "gemini",
        "google":       "gemini",
        "huggingface":  "huggingface",
        "hugging_face": "huggingface",
        "hgf":          "huggingface",
        "hf":           "huggingface",
        "base44":       "base44",
        "b44":          "base44",
        "claw":         "claw",
        "clw":          "claw",
    }
    return mapping.get(str(value).lower().strip(), None)


def parse_amount(raw) -> Decimal:
    """Parse and validate a numeric amount. Raises ValueError on bad input."""
    try:
        amount = Decimal(str(raw))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Invalid amount. Must be a numeric value.")
    if amount <= 0:
        raise ValueError("Amount must be greater than zero.")
    if amount > Decimal("1000000000"):
        raise ValueError("Amount exceeds maximum allowed value (1,000,000,000).")
    return amount


def record_transaction(tx_type: str, platform: str, amount: Decimal,
                       to_platform: str = None, converted: Decimal = None,
                       rate: Decimal = None, note: str = ""):
    """Append a transaction record to history."""
    entry = {
        "id":        len(transaction_history) + 1,
        "type":      tx_type,          # "deposit" | "withdraw" | "exchange"
        "platform":  platform,
        "symbol":    CREDIT_META[platform]["symbol"],
        "amount":    float(amount),
        "timestamp": int(time.time()),
        "note":      note,
    }
    if tx_type == "exchange" and to_platform:
        entry["to_platform"] = to_platform
        entry["to_symbol"]   = CREDIT_META[to_platform]["symbol"]
        entry["converted"]   = float(converted) if converted else None
        entry["rate"]        = float(rate) if rate else None
    transaction_history.append(entry)
    # Keep history bounded
    if len(transaction_history) > MAX_HISTORY:
        transaction_history.pop(0)


def vault_snapshot():
    """Return current vault balances as a serialisable dict."""
    return {
        platform: {
            "balance": float(bal),
            "symbol":  CREDIT_META[platform]["symbol"],
            "name":    CREDIT_META[platform]["name"],
            "color":   CREDIT_META[platform]["color"],
        }
        for platform, bal in vault_balances.items()
    }


# ─────────────────────────────────────────────────────────────────
#  EXISTING ENDPOINTS (unchanged behaviour)
# ─────────────────────────────────────────────────────────────────

@app.route("/api/convert", methods=["POST"])
def convert():
    """Estimate conversion between credit types (does NOT touch vault)."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "error": "Request body must be JSON."}), 400

    raw_amount = data.get("amount")
    if raw_amount is None:
        return jsonify({"success": False, "error": "Missing required field: amount"}), 400

    try:
        amount = Decimal(str(raw_amount))
        if amount < 0:
            return jsonify({"success": False, "error": "Amount must be non-negative."}), 400
        if amount > Decimal("1000000000"):
            return jsonify({"success": False, "error": "Amount exceeds maximum (1,000,000,000)."}), 400
    except (InvalidOperation, ValueError):
        return jsonify({"success": False, "error": "Invalid amount."}), 400

    from_currency = normalize_currency(data.get("from_currency", ""))
    to_currency   = normalize_currency(data.get("to_currency", ""))

    supported = ", ".join(CREDIT_META.keys())
    if not from_currency:
        return jsonify({"success": False, "error": f"Unknown from_currency: '{data.get('from_currency')}'. Supported: {supported}"}), 400
    if not to_currency:
        return jsonify({"success": False, "error": f"Unknown to_currency: '{data.get('to_currency')}'. Supported: {supported}"}), 400

    rate         = EXCHANGE_RATES[from_currency][to_currency]
    inverse_rate = EXCHANGE_RATES[to_currency][from_currency]
    converted    = (amount * rate).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    from_meta    = CREDIT_META[from_currency]
    to_meta      = CREDIT_META[to_currency]

    return jsonify({
        "success":              True,
        "amount":               float(amount),
        "from_currency":        from_currency,
        "from_name":            from_meta["name"],
        "from_symbol":          from_meta["symbol"],
        "to_currency":          to_currency,
        "to_name":              to_meta["name"],
        "to_symbol":            to_meta["symbol"],
        "converted_amount":     float(converted),
        "rate":                 float(rate),
        "rate_display":         f"1 {from_meta['symbol']} = {float(rate):.4f} {to_meta['symbol']}",
        "inverse_rate":         float(inverse_rate),
        "inverse_rate_display": f"1 {to_meta['symbol']} = {float(inverse_rate):.4f} {from_meta['symbol']}",
        "timestamp":            int(time.time()),
    })


@app.route("/api/rates", methods=["GET"])
def get_rates():
    """Return all exchange rates and credit metadata."""
    rates = {
        from_c: {to_c: float(r) for to_c, r in targets.items()}
        for from_c, targets in EXCHANGE_RATES.items()
    }
    return jsonify({
        "success":   True,
        "rates":     rates,
        "credits":   CREDIT_META,
        "timestamp": int(time.time()),
    })


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status":  "ok",
        "service": "AI Credit Exchange Calculator",
        "version": "2.0.0",
    })


# ─────────────────────────────────────────────────────────────────
#  VAULT ENDPOINTS
# ─────────────────────────────────────────────────────────────────

@app.route("/api/vault/balances", methods=["GET"])
def vault_get_all_balances():
    """Return balances for all platforms in the vault."""
    return jsonify({
        "success":   True,
        "vault":     vault_snapshot(),
        "timestamp": int(time.time()),
    })


@app.route("/api/vault/balance/<platform_raw>", methods=["GET"])
def vault_get_balance(platform_raw):
    """Return balance for a single platform."""
    platform = normalize_currency(platform_raw)
    if not platform:
        return jsonify({"success": False, "error": f"Unknown platform: '{platform_raw}'."}), 400

    return jsonify({
        "success":   True,
        "platform":  platform,
        "name":      CREDIT_META[platform]["name"],
        "symbol":    CREDIT_META[platform]["symbol"],
        "balance":   float(vault_balances[platform]),
        "timestamp": int(time.time()),
    })


@app.route("/api/vault/deposit", methods=["POST"])
def vault_deposit():
    """
    Deposit tokens into a platform's vault balance.

    Request body:
        { "platform": "openai", "amount": 500 }

    Response:
        { "success": true, "platform": "openai", "deposited": 500,
          "new_balance": 5500, "symbol": "OAI", ... }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "error": "Request body must be JSON."}), 400

    platform = normalize_currency(data.get("platform", ""))
    if not platform:
        return jsonify({"success": False, "error": f"Unknown platform: '{data.get('platform')}'."}), 400

    try:
        amount = parse_amount(data.get("amount"))
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400

    vault_balances[platform] += amount
    new_balance = vault_balances[platform]
    record_transaction("deposit", platform, amount,
                       note=f"Deposited {float(amount):.4f} {CREDIT_META[platform]['symbol']}")

    return jsonify({
        "success":     True,
        "action":      "deposit",
        "platform":    platform,
        "name":        CREDIT_META[platform]["name"],
        "symbol":      CREDIT_META[platform]["symbol"],
        "deposited":   float(amount),
        "new_balance": float(new_balance),
        "vault":       vault_snapshot(),
        "timestamp":   int(time.time()),
    })


@app.route("/api/vault/withdraw", methods=["POST"])
def vault_withdraw():
    """
    Withdraw tokens from a platform's vault balance.

    Request body:
        { "platform": "openai", "amount": 200 }

    Returns 400 if insufficient balance.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "error": "Request body must be JSON."}), 400

    platform = normalize_currency(data.get("platform", ""))
    if not platform:
        return jsonify({"success": False, "error": f"Unknown platform: '{data.get('platform')}'."}), 400

    try:
        amount = parse_amount(data.get("amount"))
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400

    current = vault_balances[platform]
    if amount > current:
        return jsonify({
            "success": False,
            "error":   f"Insufficient balance. Available: {float(current):.4f} {CREDIT_META[platform]['symbol']}",
            "available": float(current),
        }), 400

    vault_balances[platform] -= amount
    new_balance = vault_balances[platform]
    record_transaction("withdraw", platform, amount,
                       note=f"Withdrew {float(amount):.4f} {CREDIT_META[platform]['symbol']}")

    return jsonify({
        "success":     True,
        "action":      "withdraw",
        "platform":    platform,
        "name":        CREDIT_META[platform]["name"],
        "symbol":      CREDIT_META[platform]["symbol"],
        "withdrawn":   float(amount),
        "new_balance": float(new_balance),
        "vault":       vault_snapshot(),
        "timestamp":   int(time.time()),
    })


@app.route("/api/vault/exchange", methods=["POST"])
def vault_exchange():
    """
    Exchange tokens between two platforms using vault balances.

    Steps:
      1. Validate from_platform has sufficient balance
      2. Deduct `amount` from from_platform
      3. Calculate converted amount using EXCHANGE_RATES
      4. Credit converted amount to to_platform
      5. Record transaction

    Request body:
        { "from_platform": "openai", "to_platform": "perplexity", "amount": 100 }

    Response includes before/after balances for both platforms.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "error": "Request body must be JSON."}), 400

    from_platform = normalize_currency(data.get("from_platform", ""))
    to_platform   = normalize_currency(data.get("to_platform", ""))

    if not from_platform:
        return jsonify({"success": False, "error": f"Unknown from_platform: '{data.get('from_platform')}'."}), 400
    if not to_platform:
        return jsonify({"success": False, "error": f"Unknown to_platform: '{data.get('to_platform')}'."}), 400
    if from_platform == to_platform:
        return jsonify({"success": False, "error": "from_platform and to_platform must be different."}), 400

    try:
        amount = parse_amount(data.get("amount"))
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400

    # Check sufficient balance
    from_balance = vault_balances[from_platform]
    if amount > from_balance:
        return jsonify({
            "success":   False,
            "error":     f"Insufficient {CREDIT_META[from_platform]['symbol']} balance. Available: {float(from_balance):.4f}",
            "available": float(from_balance),
        }), 400

    # Perform exchange calculation
    rate      = EXCHANGE_RATES[from_platform][to_platform]
    converted = (amount * rate).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

    # Snapshot before
    before = {
        from_platform: float(vault_balances[from_platform]),
        to_platform:   float(vault_balances[to_platform]),
    }

    # Apply to vault
    vault_balances[from_platform] -= amount
    vault_balances[to_platform]   += converted

    # Snapshot after
    after = {
        from_platform: float(vault_balances[from_platform]),
        to_platform:   float(vault_balances[to_platform]),
    }

    from_meta = CREDIT_META[from_platform]
    to_meta   = CREDIT_META[to_platform]

    record_transaction(
        "exchange", from_platform, amount,
        to_platform=to_platform,
        converted=converted,
        rate=rate,
        note=f"Exchanged {float(amount):.4f} {from_meta['symbol']} → {float(converted):.4f} {to_meta['symbol']}"
    )

    return jsonify({
        "success":              True,
        "action":               "exchange",
        "from_platform":        from_platform,
        "from_name":            from_meta["name"],
        "from_symbol":          from_meta["symbol"],
        "to_platform":          to_platform,
        "to_name":              to_meta["name"],
        "to_symbol":            to_meta["symbol"],
        "amount_sent":          float(amount),
        "amount_received":      float(converted),
        "rate":                 float(rate),
        "rate_display":         f"1 {from_meta['symbol']} = {float(rate):.4f} {to_meta['symbol']}",
        "balance_before":       before,
        "balance_after":        after,
        "vault":                vault_snapshot(),
        "timestamp":            int(time.time()),
    })


@app.route("/api/vault/reset", methods=["POST"])
def vault_reset():
    """Reset vault balances to the configured demo defaults."""
    global vault_balances
    vault_balances = copy.deepcopy(DEFAULT_VAULT_BALANCES)
    transaction_history.clear()
    return jsonify({
        "success":   True,
        "message":   "Vault reset to default demo balances.",
        "vault":     vault_snapshot(),
        "timestamp": int(time.time()),
    })


@app.route("/api/vault/history", methods=["GET"])
def vault_history():
    """Return the last 50 vault transactions (most recent first)."""
    limit = min(int(request.args.get("limit", 50)), 200)
    recent = list(reversed(transaction_history[-limit:]))
    return jsonify({
        "success":   True,
        "count":     len(recent),
        "history":   recent,
        "timestamp": int(time.time()),
    })


# ─────────────────────────────────────────────────────────────────
#  ERROR HANDLERS
# ─────────────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"success": False, "error": "Endpoint not found."}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"success": False, "error": "Method not allowed."}), 405


# ─────────────────────────────────────────────────────────────────
#  STARTUP
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  AI Credit Exchange Calculator — Backend API v2.0")
    print("=" * 60)
    print("  Running at: http://localhost:5000")
    print()
    print("  Calculator Endpoints:")
    print("    POST /api/convert              — Estimate conversion")
    print("    GET  /api/rates                — Exchange rates")
    print("    GET  /api/health               — Health check")
    print()
    print("  Vault Endpoints:")
    print("    GET  /api/vault/balances       — All balances")
    print("    GET  /api/vault/balance/<p>    — Single balance")
    print("    POST /api/vault/deposit        — Deposit tokens")
    print("    POST /api/vault/withdraw       — Withdraw tokens")
    print("    POST /api/vault/exchange       — Exchange between platforms")
    print("    POST /api/vault/reset          — Reset to demo balances")
    print("    GET  /api/vault/history        — Transaction history")
    print()
    print("  Default Vault Balances:")
    for p, bal in DEFAULT_VAULT_BALANCES.items():
        sym = CREDIT_META[p]["symbol"]
        print(f"    {sym}: {float(bal):,.2f}")
    print("=" * 60)
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)