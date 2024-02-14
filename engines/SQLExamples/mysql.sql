--- SCHEDULED EVENTS
  
 select t.id, t.enabled enabled, t.title, t.category AS catid, t.plugin AS plugid, t.target, t.timezone
   ,CASE 
      WHEN months IS NOT NULL  THEN 'yearly'
      WHEN days IS NOT NULL THEN 'monthly'
      WHEN weekdays IS NOT NULL  THEN 'weekly'
      WHEN hours IS NOT NULL  THEN 'daily'
      WHEN minutes IS NOT NULL THEN 'hourly'
      ELSE 'custom' END AS schedule
      ,t.hours, t.minutes, t.weekdays -- , t.days, t.months
   , chain, notify_success, notes
   , FROM_UNIXTIME(ROUND(t.created,0)) as created
   , FROM_UNIXTIME(ROUND(t.modified,0)) as modified
   , username AS createdBy
 
 from cronicle C,
 json_table(convert(C.V using utf8), '$.items[*]' columns (
    id varchar(256) PATH '$.id'
   ,title varchar(256) PATH '$.title'
   , category varchar(256) PATH '$.category'
   , plugin varchar(256) PATH '$.plugin'
   , timezone varchar(256) PATH '$.timezone'
   , target varchar(256) PATH '$.target'
   , chain varchar(256) PATH '$.chain'
   , notify_success varchar(256) PATH '$.notify_success'
   , notes varchar(4000) PATH '$.notes'
   , username  varchar(256) PATH '$.username'
   , created int PATH '$.created'
   , modified int PATH '$.modified'
   , enabled int PATH '$.enabled'
   , timing  json PATH '$.timing'
   , months  json PATH '$.timing.months'
   , days  json PATH '$.timing.days'
   , weekdays json PATH '$.timing.weekdays'
   , hours json PATH '$.timing.hours'
   , minutes json PATH '$.timing.minutes'
 )) t WHERE K like '%global/schedule/%'
 
 
 ------ COMPLETED JOBS

  SELECT K
 , JSON_VALUE(V, '$.event_title') as title
 , JSON_VALUE(V, '$.plugin_title') as plugin
 , JSON_VALUE(V, '$.target') as target
 , FROM_UNIXTIME(ROUND(JSON_VALUE(V, '$.time_start'),0)) as start_time
 , ROUND(JSON_VALUE(V, '$.elapsed'), 1) as elapsed
 , JSON_VALUE(V, '$.code') as code
 , JSON_VALUE(V, '$.description') as description
 , updated

FROM ( 
   SELECT K, convert(V using  utf8) as V, updated
   FROM cronicle C
   WHERE C.K LIKE  'jobs/%' AND C.K NOT LIKE '%.gz'
  ) C

--- PLUGIN LIST
  
 SELECT id, title FROM cronicle C,
 json_table(convert(C.V using utf8), '$.items[*]' columns (
    id varchar(256) PATH '$.id'
   ,title varchar(256) PATH '$.title'
  
 )) J WHERE K like '%global/plugins/%'

 --- CATEGORY List
 
 SELECT id, title FROM cronicle C,
 json_table(convert(C.V using utf8), '$.items[*]' columns (
    id varchar(256) PATH '$.id'
   ,title varchar(256) PATH '$.title'
  
 )) J WHERE K like '%global/categories/%'