package cn.gloduck.api.entity.model.webrtc;

import java.util.ArrayList;
import java.util.List;

/** 信令同步接口返回的事件和会话快照。 */
public class WebRtcSyncResponse {
    /** 本次已成功接收或幂等确认的出站事件 ID。 */
    public List<String> acceptedEventIds = new ArrayList<>();

    /** 本次因参数、目标或队列限制被拒绝的出站事件。 */
    public List<WebRtcRejectedEvent> rejectedEvents = new ArrayList<>();

    /** 当前参与者尚未确认消费的入站事件。 */
    public List<WebRtcSignalEvent> events = new ArrayList<>();

    /** 当前参与者已经分配到的最高入站事件序号。 */
    public Long lastSequence;

    /** 服务端响应时间，Unix 毫秒时间戳。 */
    public Long serverTime;

    /** 当前会话状态。 */
    public String sessionState;

    /** 会话关闭原因；会话未关闭时为空。 */
    public String sessionCloseReason;

    /** 除当前请求者以外的参与者最新快照。 */
    public List<WebRtcParticipantInfo> participants = new ArrayList<>();
}
