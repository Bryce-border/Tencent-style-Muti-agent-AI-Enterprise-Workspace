package com.enterprise.workspace;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class TaskDispatch {
    private final TaskRepository tasks; private final JdbcTemplate db; private final RabbitTemplate rabbit;
    private final String queue; private final boolean enabled;
    public TaskDispatch(TaskRepository tasks,JdbcTemplate db,RabbitTemplate rabbit,@Value("${workspace.queue-name}") String queue,@Value("${workspace.dispatch-enabled}") boolean enabled) {
        this.tasks=tasks; this.db=db; this.rabbit=rabbit; this.queue=queue; this.enabled=enabled;
    }
    @Bean Queue tasksQueue() { return new Queue(queue,true); }

    @Scheduled(fixedDelay=3000)
    public void dispatch() {
        if (!enabled) return;
        for (String id:db.queryForList("SELECT task_id FROM tasks WHERE status='RUNNING' AND lease_until<?",String.class,System.currentTimeMillis())) tasks.recover(id);
        for (String id:db.queryForList("SELECT o.task_id FROM task_outbox o JOIN tasks t ON t.task_id=o.task_id WHERE t.status='PENDING' AND o.published_ms<? LIMIT 30",String.class,System.currentTimeMillis()-30000)) {
            try {
                var properties=new MessageProperties(); properties.setContentType("application/json"); properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                var confirm=new CorrelationData();
                rabbit.send("",queue,new Message(("{\"task_id\":\""+id+"\"}").getBytes(StandardCharsets.UTF_8),properties),confirm);
                if (confirm.getFuture().get(5,TimeUnit.SECONDS).isAck() && confirm.getReturned()==null)
                    db.update("UPDATE task_outbox SET published_ms=? WHERE task_id=?",System.currentTimeMillis(),id);
            } catch (Exception ex) {
                // Leave the outbox pending; a later dispatch recovers broker outages without losing the task.
                break;
            }
        }
    }
}
