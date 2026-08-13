package cn.gloduck.common.entity.base;

/**
 * 通用响应结果
 *
 * @author Gloduck
 * @date 2022/10/11
 */
public class Result<T> {
    private Result(Integer code, String msg, T data) {
        this.code = code;
        this.msg = msg;
        this.data = data;
    }


    /**
     * 成功结果
     */
    @SuppressWarnings("rawtypes")
    private static final Result SUCCESS_RESULT = result(StatusCode.SUCCESS, null);


    /**
     * 未找到资源
     */
    @SuppressWarnings("rawtypes")
    private static final Result NOT_FOUNT_RESULT = result(StatusCode.DATA_NOT_FOUND, null);

    /**
     * 失败结果
     */
    @SuppressWarnings("rawtypes")
    private static final Result FAILED_RESULT = result(StatusCode.OPERATION_FAILED, null);

    @SuppressWarnings("rawtypes")
    private static final Result ERROR_RESULT = result(StatusCode.INTERNAL_SERVER_ERROR, null);

    private final Integer code;
    private final String msg;
    private final T data;

    /**
     * 结果
     *
     * @param code 状态码
     * @param msg  消息
     * @param data 数据
     * @return {@link Result}<{@link T}>
     */
    public static <T> Result<T> result(StatusCode code, String msg, T data) {
        return new Result<>(code.value, msg, data);
    }


    /**
     * 结果，msg取，code的默认msg
     *
     * @param code 状态码
     * @param data 数据
     * @return {@link Result}<{@link T}>
     */
    public static <T> Result<T> result(StatusCode code, T data) {
        return new Result<>(code.value, code.defaultMsg, data);
    }

    /**
     * 未找到资源
     *
     * @return {@link Result}<{@link T}>
     */
    @SuppressWarnings("unchecked")
    public static <T> Result<T> notFound() {
        return NOT_FOUNT_RESULT;
    }

    /**
     * 失败
     *
     * @return {@link Result}<{@link T}>
     */
    @SuppressWarnings("unchecked")
    public static <T> Result<T> fail() {
        return FAILED_RESULT;
    }

    /**
     * 失败
     *
     * @param msg 消息
     * @return {@link Result}<{@link T}>
     */
    public static <T> Result<T> fail(String msg) {
        return new Result<>(StatusCode.OPERATION_FAILED.value, msg, null);
    }

    /**
     * 错误
     *
     * @return {@link Result}<{@link T}>
     */
    @SuppressWarnings("unchecked")
    public static <T> Result<T> error() {
        return ERROR_RESULT;
    }

    /**
     * 错误
     *
     * @param msg 消息
     * @return {@link Result}<{@link T}>
     */
    public static <T> Result<T> error(String msg) {
        return new Result<>(StatusCode.INTERNAL_SERVER_ERROR.value, msg, null);
    }

    /**
     * 成功
     *
     * @return {@link Result}<{@link T}>
     */
    @SuppressWarnings("unchecked")
    public static <T> Result<T> success() {
        return SUCCESS_RESULT;
    }

    /**
     * 成功
     *
     * @param data 数据
     * @return {@link Result}<{@link T}>
     */
    public static <T> Result<T> success(T data) {
        return result(StatusCode.SUCCESS, data);
    }

    /**
     * 成功
     *
     * @param msg  提示
     * @param data 数据
     * @return {@link Result}<{@link T}>
     */
    public static <T> Result<T> success(String msg, T data) {
        return new Result<>(StatusCode.SUCCESS.value, msg, data);
    }

    public Integer getCode() {
        return code;
    }

    public String getMsg() {
        return msg;
    }

    public T getData() {
        return data;
    }

    @Override
    public String toString() {
        return "Result{" +
                "code=" + code +
                ", msg='" + msg + '\'' +
                ", data=" + data +
                '}';
    }

    /**
     * 状态码枚举
     *
     * @author Gloduck
     * @date 2022/10/11
     */
    public enum StatusCode {
        /**
         * 成功
         */
        SUCCESS(200, "success"),


        /**
         * 未找到资源
         */
        DATA_NOT_FOUND(404, "DATA_NOT_FOUND"),

        /**
         * 失败
         */
        OPERATION_FAILED(417, "OPERATION_FAILED"),

        /**
         * 错误
         */
        INTERNAL_SERVER_ERROR(500, "INTERNAL_SERVER_ERROR");

        /**
         * 默认值
         */
        private final int value;

        /**
         * 默认错误提示
         */
        private final String defaultMsg;

        StatusCode(int value, String defaultMsg) {
            this.value = value;
            this.defaultMsg = defaultMsg;
        }
    }
}
