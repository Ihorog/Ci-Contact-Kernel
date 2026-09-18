package ua.cimeika.cipoint;

final class CiGestureRouter {
    enum Command {
        MATERIALIZE_CONTEXT,
        DISMISS_CONTEXT,
        BROWSE_NEWER,
        BROWSE_OLDER,
        BRANCH_CONTEXT,
        RESERVED
    }

    Command routeOverlaySwipe(String direction, boolean haloVisible) {
        if ("left".equals(direction)) return Command.MATERIALIZE_CONTEXT;
        if ("right".equals(direction)) return Command.DISMISS_CONTEXT;
        if (haloVisible && "up".equals(direction)) return Command.BROWSE_NEWER;
        if (haloVisible && "down".equals(direction)) return Command.BROWSE_OLDER;
        return Command.RESERVED;
    }

    Command routeCardSwipe(String direction) {
        if ("up".equals(direction)) return Command.BROWSE_NEWER;
        if ("down".equals(direction)) return Command.BROWSE_OLDER;
        if ("right".equals(direction)) return Command.DISMISS_CONTEXT;
        if ("left".equals(direction)) return Command.BRANCH_CONTEXT;
        return Command.RESERVED;
    }
}
