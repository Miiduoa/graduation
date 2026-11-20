/**
 * Campus App Android Widget
 * 
 * 這是 Android Widget 的 Kotlin 程式碼範本。
 * 需要在 Android Studio 中配置並使用此程式碼。
 */

package com.campus.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.graphics.Color
import java.text.SimpleDateFormat
import java.util.*
import org.json.JSONArray
import org.json.JSONObject

/**
 * 今日課表 Widget Provider
 */
class TodayScheduleWidgetProvider : AppWidgetProvider() {
    
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateTodayScheduleWidget(context, appWidgetManager, appWidgetId)
        }
    }
    
    companion object {
        fun updateTodayScheduleWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_today_schedule)
            
            // 設定標題
            val dateFormat = SimpleDateFormat("EEEE", Locale.TAIWAN)
            views.setTextViewText(R.id.widget_day_of_week, dateFormat.format(Date()))
            
            // 從 SharedPreferences 讀取課表資料
            val prefs = context.getSharedPreferences("widget_data", Context.MODE_PRIVATE)
            val coursesJson = prefs.getString("today_schedule", "[]")
            
            try {
                val courses = JSONArray(coursesJson)
                val courseList = StringBuilder()
                
                for (i in 0 until minOf(courses.length(), 4)) {
                    val course = courses.getJSONObject(i)
                    courseList.append("${course.getString("time")} ${course.getString("name")}\n")
                    courseList.append("📍 ${course.getString("location")}\n\n")
                }
                
                if (courses.length() == 0) {
                    views.setTextViewText(R.id.widget_courses, "今天沒有課程 ☀️")
                } else {
                    views.setTextViewText(R.id.widget_courses, courseList.toString().trim())
                }
            } catch (e: Exception) {
                views.setTextViewText(R.id.widget_courses, "無法載入課表")
            }
            
            // 設定點擊事件
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            intent?.putExtra("screen", "schedule")
            val pendingIntent = PendingIntent.getActivity(
                context, 
                0, 
                intent, 
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_container, pendingIntent)
            
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}

/**
 * 下一堂課 Widget Provider
 */
class NextClassWidgetProvider : AppWidgetProvider() {
    
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateNextClassWidget(context, appWidgetManager, appWidgetId)
        }
    }
    
    companion object {
        fun updateNextClassWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_next_class)
            
            val prefs = context.getSharedPreferences("widget_data", Context.MODE_PRIVATE)
            val nextClassJson = prefs.getString("next_class", null)
            
            try {
                if (nextClassJson != null) {
                    val nextClass = JSONObject(nextClassJson)
                    
                    if (nextClass.getBoolean("hasNextClass")) {
                        val course = nextClass.getJSONObject("course")
                        views.setTextViewText(R.id.widget_course_name, course.getString("name"))
                        views.setTextViewText(R.id.widget_course_time, course.getString("startTime"))
                        views.setTextViewText(R.id.widget_course_location, course.getString("location"))
                        
                        val minutes = course.getInt("minutesUntilStart")
                        views.setTextViewText(R.id.widget_countdown, "${minutes} 分鐘後開始")
                    } else {
                        views.setTextViewText(R.id.widget_course_name, "今天沒有課程")
                        views.setTextViewText(R.id.widget_course_time, "")
                        views.setTextViewText(R.id.widget_course_location, "")
                        views.setTextViewText(R.id.widget_countdown, "好好休息！")
                    }
                } else {
                    views.setTextViewText(R.id.widget_course_name, "載入中...")
                    views.setTextViewText(R.id.widget_course_time, "")
                    views.setTextViewText(R.id.widget_course_location, "")
                    views.setTextViewText(R.id.widget_countdown, "")
                }
            } catch (e: Exception) {
                views.setTextViewText(R.id.widget_course_name, "無法載入")
            }
            
            // 設定點擊事件
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            intent?.putExtra("screen", "schedule")
            val pendingIntent = PendingIntent.getActivity(
                context, 
                1, 
                intent, 
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_container, pendingIntent)
            
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}

/**
 * 公車到站 Widget Provider
 */
class BusArrivalWidgetProvider : AppWidgetProvider() {
    
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateBusArrivalWidget(context, appWidgetManager, appWidgetId)
        }
    }
    
    companion object {
        fun updateBusArrivalWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_bus_arrival)
            
            val prefs = context.getSharedPreferences("widget_data", Context.MODE_PRIVATE)
            val busDataJson = prefs.getString("bus_arrival", null)
            
            try {
                if (busDataJson != null) {
                    val busData = JSONObject(busDataJson)
                    views.setTextViewText(R.id.widget_stop_name, busData.getString("stopName"))
                    
                    val arrivals = busData.getJSONArray("arrivals")
                    val arrivalText = StringBuilder()
                    
                    for (i in 0 until minOf(arrivals.length(), 3)) {
                        val arrival = arrivals.getJSONObject(i)
                        val minutes = arrival.getInt("estimatedMinutes")
                        val routeName = arrival.getString("routeName")
                        arrivalText.append("$routeName: ${minutes}分\n")
                    }
                    
                    views.setTextViewText(R.id.widget_arrivals, arrivalText.toString().trim())
                } else {
                    views.setTextViewText(R.id.widget_stop_name, "校門口站")
                    views.setTextViewText(R.id.widget_arrivals, "載入中...")
                }
            } catch (e: Exception) {
                views.setTextViewText(R.id.widget_arrivals, "無法載入")
            }
            
            // 設定點擊事件
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            intent?.putExtra("screen", "bus")
            val pendingIntent = PendingIntent.getActivity(
                context, 
                2, 
                intent, 
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_container, pendingIntent)
            
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}

/**
 * 公告 Widget Provider
 */
class AnnouncementWidgetProvider : AppWidgetProvider() {
    
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateAnnouncementWidget(context, appWidgetManager, appWidgetId)
        }
    }
    
    companion object {
        fun updateAnnouncementWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_announcement)
            
            val prefs = context.getSharedPreferences("widget_data", Context.MODE_PRIVATE)
            val announcementsJson = prefs.getString("announcements", null)
            
            try {
                if (announcementsJson != null) {
                    val data = JSONObject(announcementsJson)
                    val announcements = data.getJSONArray("announcements")
                    val unreadCount = data.getInt("unreadCount")
                    
                    views.setTextViewText(R.id.widget_unread_count, if (unreadCount > 0) "$unreadCount" else "")
                    
                    val announcementText = StringBuilder()
                    for (i in 0 until minOf(announcements.length(), 3)) {
                        val announcement = announcements.getJSONObject(i)
                        val title = announcement.getString("title")
                        val source = announcement.getString("source")
                        val isUrgent = announcement.optBoolean("isUrgent", false)
                        
                        if (isUrgent) {
                            announcementText.append("⚠️ ")
                        }
                        announcementText.append("$title\n")
                        announcementText.append("— $source\n\n")
                    }
                    
                    views.setTextViewText(R.id.widget_announcements, announcementText.toString().trim())
                } else {
                    views.setTextViewText(R.id.widget_announcements, "載入中...")
                }
            } catch (e: Exception) {
                views.setTextViewText(R.id.widget_announcements, "無法載入公告")
            }
            
            // 設定點擊事件
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            intent?.putExtra("screen", "announcements")
            val pendingIntent = PendingIntent.getActivity(
                context, 
                3, 
                intent, 
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_container, pendingIntent)
            
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}

/**
 * Widget 資料同步服務
 * 由 React Native 調用來更新 Widget 資料
 */
object WidgetDataSync {
    
    fun updateTodaySchedule(context: Context, coursesJson: String) {
        val prefs = context.getSharedPreferences("widget_data", Context.MODE_PRIVATE)
        prefs.edit().putString("today_schedule", coursesJson).apply()
        
        // 通知 Widget 更新
        val intent = Intent(context, TodayScheduleWidgetProvider::class.java)
        intent.action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
        context.sendBroadcast(intent)
    }
    
    fun updateNextClass(context: Context, nextClassJson: String) {
        val prefs = context.getSharedPreferences("widget_data", Context.MODE_PRIVATE)
        prefs.edit().putString("next_class", nextClassJson).apply()
        
        val intent = Intent(context, NextClassWidgetProvider::class.java)
        intent.action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
        context.sendBroadcast(intent)
    }
    
    fun updateBusArrival(context: Context, busDataJson: String) {
        val prefs = context.getSharedPreferences("widget_data", Context.MODE_PRIVATE)
        prefs.edit().putString("bus_arrival", busDataJson).apply()
        
        val intent = Intent(context, BusArrivalWidgetProvider::class.java)
        intent.action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
        context.sendBroadcast(intent)
    }
    
    fun updateAnnouncements(context: Context, announcementsJson: String) {
        val prefs = context.getSharedPreferences("widget_data", Context.MODE_PRIVATE)
        prefs.edit().putString("announcements", announcementsJson).apply()
        
        val intent = Intent(context, AnnouncementWidgetProvider::class.java)
        intent.action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
        context.sendBroadcast(intent)
    }
    
    fun refreshAllWidgets(context: Context) {
        val intents = listOf(
            Intent(context, TodayScheduleWidgetProvider::class.java),
            Intent(context, NextClassWidgetProvider::class.java),
            Intent(context, BusArrivalWidgetProvider::class.java),
            Intent(context, AnnouncementWidgetProvider::class.java)
        )
        
        intents.forEach { intent ->
            intent.action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
            context.sendBroadcast(intent)
        }
    }
}
