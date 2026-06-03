// ExportEconomicCalendar.mq5
// Attach/run inside MetaTrader 5. This uses the native MQL5 Economic Calendar API:
// https://www.mql5.com/en/docs/calendar
//
// Output target expected by the backend:
//   <project>/data/economic_calendar.json
//
// Practical setup:
// 1. Update ExportPath below to your project path if needed.
// 2. Compile in MetaEditor.
// 3. Run the script manually or schedule it with an EA/timer.
//
// Note: MQL5 calendar values use trade server time. Keep this visible in UI decisions.

#property script_show_inputs

input string ExportPath = "C:\\Users\\mulya\\Documents\\XAUGBPEUUSD\\data\\economic_calendar.json";
input int DaysBack = 1;
input int DaysAhead = 7;

string ImpactToText(const int importance)
{
   if(importance >= 3) return "high";
   if(importance == 2) return "medium";
   return "low";
}

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   return value;
}

void OnStart()
{
   string currencies[3] = {"USD", "GBP", "EUR"};
   datetime from_time = TimeTradeServer() - DaysBack * 86400;
   datetime to_time = TimeTradeServer() + DaysAhead * 86400;
   string json = "{\"generated_at\":\"" + TimeToString(TimeTradeServer(), TIME_DATE|TIME_SECONDS) + "\",\"events\":[";
   bool first = true;

   for(int c = 0; c < ArraySize(currencies); c++)
   {
      MqlCalendarValue values[];
      int count = CalendarValueHistory(values, from_time, to_time, NULL, currencies[c]);
      if(count <= 0)
         continue;

      for(int i = 0; i < count; i++)
      {
         MqlCalendarEvent event;
         if(!CalendarEventById(values[i].event_id, event))
            continue;

         if(!first)
            json += ",";
         first = false;

         json += "{";
         json += "\"id\":\"" + (string)values[i].id + "\",";
         json += "\"time\":\"" + TimeToString(values[i].time, TIME_DATE|TIME_SECONDS) + "\",";
         json += "\"currency\":\"" + currencies[c] + "\",";
         json += "\"country\":\"" + currencies[c] + "\",";
         json += "\"title\":\"" + JsonEscape(event.name) + "\",";
         json += "\"impact\":\"" + ImpactToText((int)event.importance) + "\",";
         json += "\"actual\":\"" + DoubleToString(values[i].actual_value, event.digits) + "\",";
         json += "\"forecast\":\"" + DoubleToString(values[i].forecast_value, event.digits) + "\",";
         json += "\"previous\":\"" + DoubleToString(values[i].prev_value, event.digits) + "\"";
         json += "}";
      }
   }

   json += "]}";
   int handle = FileOpen(ExportPath, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
   {
      Print("Failed to open calendar export path: ", ExportPath, " error=", GetLastError());
      return;
   }
   FileWriteString(handle, json);
   FileClose(handle);
   Print("Economic calendar exported to ", ExportPath);
}
