package cn.gloduck.api.exceptions;

public class ApiException extends RuntimeException {
    private final ApiError error;

    public ApiException(ApiError error) {
        this(error, null);
    }

    public ApiException(ApiError error, Throwable cause) {
        super(error.name(), cause);
        this.error = error;
    }

    public ApiError getError() {
        return error;
    }
}
