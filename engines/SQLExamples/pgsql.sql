------ scheduled events

 SELECT t.id, t.title, t.enabled, t.category AS catid, t.plugin AS plugid, t.target, t.timezone
   ,CASE 
      WHEN timing->'months' IS NOT NULL  THEN 'yearly'
      WHEN timing->'days' IS NOT NULL THEN 'monthly'
      WHEN timing->'weekdays' IS NOT NULL  THEN 'weekly'
      WHEN timing->'hours' IS NOT NULL  THEN 'daily'
      WHEN timing->'minutes' IS NOT NULL THEN 'hourly'
      ELSE 'custom' END AS schedule
   ,timing->'hours' as hours
   , timing->'minutes' as minutes
   , timing->'weekdays' as weekdays
   -- , timing->'days' as days, timing->'months' as months
   , chain, notify_success, notes
   , to_timestamp(t.created) as created
   , to_timestamp(t.modified) as modified
   , username AS createdBy
   
from cronicle c, jsonb_to_recordset(convert_from("V", 'UTF8')::jsonb->'items') as t(
    id varchar(256)
  , title varchar(256)
    , category varchar(256)
   , plugin varchar(256)
   , timezone varchar(256)
   , target varchar(256) 
   , chain varchar(256)
   , notify_success varchar(256)
   , notes varchar(4000) 
   , username  varchar(256)
   , created int 
   , modified int 
   , enabled int 
   , timing  json 
)
where "K" like 'global/schedule/%'

---- completed jobs 

select id, event_title as event, plugin_title as plugin, category_title as cat, target
, to_timestamp(time_start) as start_time 
, elapsed::int as elapsed
,code, description
from cronicle c, json_to_record(convert_from("V", 'UTF8')::json) as j(
      id varchar(256)
    , event_title varchar(256)
    , plugin_title varchar(256)
    , category_title varchar(256)
    , target varchar(256)
    , time_start float
    , elapsed float
    , code int
    , description varchar(2000)
    )
where "K" like 'jobs%' and "K" not like '%.gz'


----- plugins
select id, title
from cronicle c, jsonb_to_recordset(convert_from("V", 'UTF8')::jsonb->'items') as t(
    id varchar(256), title varchar(256))
where "K" like 'global/plugins/%'

----- categories
select id, title
from cronicle c, jsonb_to_recordset(convert_from("V", 'UTF8')::jsonb->'items') as t(
    id varchar(256), title varchar(256))
where "K" like 'global/categories/%'
