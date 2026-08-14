package cn.gloduck.api.entity.model.webrtc;

import java.util.List;

/** 轮询同步信令事件的请求。 */
public class WebRtcSyncRequest {
    /** 客户端已经成功处理的最高入站事件序号。 */
    public Long ackSequence;

    /** 本次需要发送给其他参与者的出站事件。 */
    public List<WebRtcOutgoingEvent> events;
}
