package ua.cimeika.cipoint;

final class CiStateMachine {
    enum Surface {
        IDLE,
        WATCH,
        VOICE,
        ADS,
        CONTEXT,
        CONFIRM,
        RESULT
    }

    static final class Snapshot {
        final Surface surface;
        final long revision;
        final String reason;

        Snapshot(Surface surface, long revision, String reason) {
            this.surface = surface;
            this.revision = revision;
            this.reason = reason == null ? "" : reason;
        }
    }

    private Surface surface = Surface.IDLE;
    private long revision;
    private String reason = "boot";

    synchronized Snapshot transition(Surface next, String why) {
        if (next == null) next = Surface.IDLE;
        if (surface != next || (why != null && !why.equals(reason))) {
            surface = next;
            reason = why == null ? "" : why;
            revision++;
        }
        return snapshot();
    }

    synchronized Snapshot snapshot() {
        return new Snapshot(surface, revision, reason);
    }

    synchronized boolean is(Surface expected) {
        return surface == expected;
    }
}
