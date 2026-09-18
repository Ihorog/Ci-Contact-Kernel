package ua.cimeika.cipoint;

import org.json.JSONObject;

interface CiContextProvider {
    interface Callback {
        void onSuccess(JSONObject payload);
        void onError(String error);
    }

    void requestContext(String gesture, String direction, JSONObject state, Callback callback);

    void execute(CiContextCard card, JSONObject state, Callback callback);

    void close();
}
