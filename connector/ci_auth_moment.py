"""Ci authorization moment v1: bounded, inspectable consent descriptor.

No credentials, biometric data, raw attestations, or authority are issued here.
The caller must bind the returned digest to its SERVER-SIDE WebAuthn
challenge and verify the assertion before granting any permission.
"""
import hashlib
import json
import re

KIND = "CI.AUTH.MOMENT/1.0"
RP_ID = "mcp-http.cimeika.com.ua"
ORIGIN = "https://" + RP_ID
_ALLOWED_EFFECTS = {"read", "local_change", "external_change", "document_signature"}
_ALLOWED_DOMAINS = {"HOME.CI", "BUSINESS", "PERSONAL"}
_ID = re.compile(r"^[A-Za-z0-9_.:@/-]{1,128}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")


class ContractError(ValueError):
    pass


def _text(value, name, limit=240):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ContractError("invalid_" + name)
    return value.strip()


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def moment_digest(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def create_moment(*, task_id, principal, domain, target, operation, purpose,
                  effect, requested_scope, policy_ref, issued_at, expires_at,
                  client_id, resource, terms_sha256=None, parent_id=None):
    """Prepare a declaration, NOT an authorization grant or legal signature.

    Display these exact attributes to the owner before requesting WebAuthn.
    Use moment_digest in the server-side challenge state. Never take this
    structure as proof that the user or their device actually approved it.
    """
    if domain not in _ALLOWED_DOMAINS:
        raise ContractError("unrecognized_authority_domain")
    if effect not in _ALLOWED_EFFECTS:
        raise ContractError("unrecognized_effect")
    if not isinstance(issued_at, int) or isinstance(issued_at, bool):
        raise ContractError("invalid_issue_time")
    if not isinstance(expires_at, int) or isinstance(expires_at, bool):
        raise ContractError("invalid_expiry")
    if not 0 < expires_at - issued_at <= 300:
        raise ContractError("non_bounded_lifetime")
    for key, value in (("task_id", task_id), ("principal", principal),
                       ("target", target), ("operation", operation),
                       ("client_id", client_id), ("resource", resource)):
        if not isinstance(value, str) or not _ID.fullmatch(value) if key not in ("resource",) else not isinstance(value, str):
            raise ContractError("invalid_" + key)
    if parent_id is not None and (not isinstance(parent_id, str) or not _ID.fullmatch(parent_id)):
        raise ContractError("invalid_parent_id")
    if requested_scope not in {"ci:read", "ci:act"}:
        raise ContractError("invalid_scope")
    if effect in {"local_change", "external_change"} and requested_scope != "ci:act":
        raise ContractError("scope_insufficient")
    if domain == "HOME.CI" and effect == "external_change":
        raise ContractError("home_external_authority_forbidden")
    if effect == "document_signature":
        raise ContractError("qualified_signature_requires_separate_provider")
    if not isinstance(resource, str) or resource != ORIGIN:
        raise ContractError("wrong_resource")
    if terms_sha256 is not None and (not isinstance(terms_sha256, str)
                                     or not _SHA.fullmatch(terms_sha256)):
        raise ContractError("invalid_terms_hash")
    return {
        "kind": KIND,
        "task_id": task_id,
        "parent_id": parent_id,
        "principal": principal,
        "domain": domain,
        "target": target,
        "operation": operation,
        "purpose": _text(purpose, "purpose", 320),
        "effect": effect,
        "requested_scope": requested_scope,
        "policy_ref": _text(policy_ref, "policy_ref", 128),
        "terms_sha256": terms_sha256,
        "client_id": client_id,
        "resource": ORIGIN,
        "rp_id": RP_ID,
        "origin": ORIGIN,
        "issued_at": issued_at,
        "expires_at": expires_at,
        "authenticator": "platform-passkey-or-fido2",
        "user_verification": "required",
    }


def acceptance_summary(moment):
    """Summary to persist only AFTER server-side assertion verification.

    The digest alone does not prove consent, identity, execution, or qualified
    electronic signing. Evidence must separately link to a verified assertion.
    """
    if not isinstance(moment, dict) or moment.get("kind") != KIND:
        raise ContractError("invalid_moment")
    return {
        "moment_sha256": moment_digest(moment),
        "task_id": moment["task_id"],
        "scope": moment["requested_scope"],
        "effect": moment["effect"],
        "target": moment["target"],
        "expires_at": moment["expires_at"],
        "proof_status": "AWAITING_VERIFIED_WEBAUTHN_ASSERTION",
        "document_signature": False,
    }
