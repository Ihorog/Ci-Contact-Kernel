package ua.cimeika.cipoint;

final class CiSurfaceRouter {
    private final CiStateMachine state;
    private final CiWatchHalo watch;
    private final CiAdsHalo ads;
    private final CiContextHalo context;
    private final CiResultProjection result;
    private final Runnable stopVoice;

    CiSurfaceRouter(
            CiStateMachine state,
            CiWatchHalo watch,
            CiAdsHalo ads,
            CiContextHalo context,
            CiResultProjection result,
            Runnable stopVoice
    ) {
        this.state = state;
        this.watch = watch;
        this.ads = ads;
        this.context = context;
        this.result = result;
        this.stopVoice = stopVoice;
    }

    CiStateMachine.Snapshot activate(CiStateMachine.Surface next, String reason) {
        if (next == null) next = CiStateMachine.Surface.IDLE;

        switch (next) {
            case IDLE:
                stopVoice();
                clearWatch();
                clearAds();
                clearContext();
                clearResult();
                break;

            case WATCH:
                stopVoice();
                clearAds();
                clearContext();
                clearResult();
                break;

            case VOICE:
                // Watch is the visual shell for explicit voice invocation.
                clearAds();
                clearContext();
                clearResult();
                break;

            case ADS:
                stopVoice();
                clearWatch();
                clearContext();
                clearResult();
                break;

            case CONTEXT:
                stopVoice();
                clearWatch();
                clearAds();
                clearResult();
                break;

            case CONFIRM:
                // Preserve the current shell (Watch or Ads) and any projected
                // result needed to understand what is being confirmed.
                stopVoice();
                clearContext();
                break;

            case RESULT:
                stopVoice();
                clearWatch();
                clearAds();
                clearContext();
                break;
        }

        return state.transition(next, reason);
    }

    CiStateMachine.Snapshot snapshot() {
        return state.snapshot();
    }

    boolean is(CiStateMachine.Surface surface) {
        return state.is(surface);
    }

    private void stopVoice() {
        if (stopVoice != null) stopVoice.run();
    }

    private void clearWatch() {
        if (watch != null) watch.clear();
    }

    private void clearAds() {
        if (ads != null) ads.clear();
    }

    private void clearContext() {
        if (context != null) context.clear();
    }

    private void clearResult() {
        if (result != null) result.clear();
    }
}
