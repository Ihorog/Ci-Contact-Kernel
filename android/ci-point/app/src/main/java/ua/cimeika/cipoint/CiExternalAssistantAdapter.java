package ua.cimeika.cipoint;

interface CiExternalAssistantAdapter {
    String id();

    boolean isAvailable();

    String open();
}
