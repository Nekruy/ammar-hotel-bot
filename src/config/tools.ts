// src/config/tools.ts — 15 инструментов (OpenAI format, Groq-compatible)
import OpenAI from "openai";

export const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [

  { type:"function", function:{ name:"get_booking",
    description:"Информация о бронировании гостя — даты заезда/выезда, тип номера, статус. Вызывай если гость спрашивает о своей брони, датах, продлении.",
    parameters:{ type:"object", properties:{ room_number:{type:"string"} }} }},

  { type:"function", function:{ name:"create_room_service",
    description:"Заказ еды и напитков в номер (07:00–23:00). ВЫЗЫВАЙ СРАЗУ когда гость упоминает еду, чай, кофе, воду, напитки или голод — без лишних уточнений.",
    parameters:{ type:"object", required:["room_number","items"],
    properties:{
      room_number:   { type:"string" },
      items:         { type:"array", items:{ type:"object", required:["name","quantity"],
                       properties:{ name:{type:"string"}, quantity:{type:"number"}, notes:{type:"string"} }}},
      delivery_time: { type:"string" },
    }}}},

  { type:"function", function:{ name:"create_housekeeping",
    description:"Задача хаускипинга: уборка, полотенца, фен, тапочки, подушки. ВЫЗЫВАЙ СРАЗУ когда гость упоминает любой из этих предметов — не спрашивай разрешения.",
    parameters:{ type:"object", required:["room_number","task_type"],
    properties:{
      room_number:  { type:"string" },
      task_type:    { type:"string", enum:["cleaning","towels","pillows","slippers","iron","hairdryer","minibar","other"] },
      description:  { type:"string" },
      priority:     { type:"string", enum:["normal","urgent"] },
    }}}},

  { type:"function", function:{ name:"arrange_taxi",
    description:"Заказ такси или трансфера в аэропорт. Вызывай когда гость упоминает такси, трансфер, аэропорт, поездку.",
    parameters:{ type:"object", required:["room_number","destination","pickup_time"],
    properties:{
      room_number:  { type:"string" },
      destination:  { type:"string" },
      pickup_time:  { type:"string" },
      passengers:   { type:"number" },
      taxi_type:    { type:"string", enum:["standard","comfort","airport_transfer"] },
    }}}},

  { type:"function", function:{ name:"get_city_info",
    description:"Гид по Душанбе: рестораны, достопримечательности, транспорт, шопинг, обмен валюты. ВЫЗЫВАЙ если гость скучает, не знает куда пойти, хочет погулять или посмотреть город.",
    parameters:{ type:"object", required:["category"],
    properties:{
      category: { type:"string", enum:["restaurants","attractions","transport","shopping","exchange"] },
      query:    { type:"string" },
    }}}},

  { type:"function", function:{ name:"get_exchange_rate",
    description:"Актуальный курс валюты к таджикскому сомони TJS. ВЫЗЫВАЙ СРАЗУ если гость упоминает деньги, обмен, покупки, доллары, рубли, евро, юани.",
    parameters:{ type:"object", required:["currency"],
    properties:{
      currency: { type:"string", enum:["USD","RUB","EUR","CNY","GBP"] },
    }}}},

  { type:"function", function:{ name:"escalate_to_staff",
    description:"Передать СРОЧНО живому сотруднику. ВЫЗЫВАЙ НЕМЕДЛЕННО при: жалобе, недовольстве, поломке, любых словах 'жалоба/недоволен/ужасно/terrible/awful/投诉/糟糕/шикоят/бад', просьбе позвать менеджера, пожаре, медицинской помощи. Приоритет urgent — при жалобах и недовольстве.",
    parameters:{ type:"object", required:["room_number","reason","priority"],
    properties:{
      room_number: { type:"string" },
      reason:      { type:"string" },
      priority:    { type:"string", enum:["normal","urgent","emergency"] },
      summary:     { type:"string" },
    }}}},

  { type:"function", function:{ name:"create_upsell",
    description:"Предложение гостю: ужин в ресторане, завтрак в номер, экскурсия. Вызывай ТОЛЬКО если гость явно доволен (говорит 'спасибо', 'отлично', 'всё хорошо'). НЕ навязывай при нейтральных или негативных сообщениях.",
    parameters:{ type:"object", required:["room_number","offer_type"],
    properties:{
      room_number: { type:"string" },
      offer_type:  { type:"string", enum:["restaurant","breakfast","excursion"] },
    }}}},

  { type:"function", function:{ name:"get_restaurant_menu",
    description:"Меню ресторана AMMAR Hotel. Вызывай когда гость голоден, хочет поесть, спрашивает что есть в ресторане.",
    parameters:{ type:"object",
    properties:{
      meal_time: { type:"string", enum:["breakfast","lunch","dinner","drinks","all"] },
    }}}},

  { type:"function", function:{ name:"request_wake_up",
    description:"Заказ звонка-побудки от ресепшн. ВЫЗЫВАЙ СРАЗУ если гость упоминает ранний рейс, встречу утром, 'разбудите меня', 'нужно встать в X'. Уточни время если не сказано.",
    parameters:{ type:"object", required:["room_number","wake_time"],
    properties:{
      room_number: { type:"string" },
      wake_time:   { type:"string", description:"Время в формате HH:MM, например 07:30" },
      date:        { type:"string", description:"Дата YYYY-MM-DD, если не сегодня" },
    }}}},

  { type:"function", function:{ name:"arrange_excursion",
    description:"Организация экскурсии по Таджикистану. Вызывай если гость скучает, хочет куда-то поехать, интересуется природой или достопримечательностями страны.",
    parameters:{ type:"object", required:["room_number","destination"],
    properties:{
      room_number:  { type:"string" },
      destination:  { type:"string", enum:["Romit","Takob","Iskanderkul","Penjikent","Hissar","city_tour"] },
      date:         { type:"string" },
      participants: { type:"number" },
    }}}},

  { type:"function", function:{ name:"get_weather",
    description:"Актуальная погода и прогноз в Душанбе. ВЫЗЫВАЙ если гость спрашивает о погоде, что надеть, идти ли гулять, планирует прогулку или выезд на природу.",
    parameters:{ type:"object",
    properties:{
      days: { type:"number", description:"Количество дней прогноза (1–5)" },
    }}}},

  { type:"function", function:{ name:"request_late_checkout",
    description:"Запрос позднего выезда (после 12:00). Уточни у гостя желаемое время если не сказано, затем вызови.",
    parameters:{ type:"object", required:["room_number","checkout_time"],
    properties:{
      room_number:   { type:"string" },
      checkout_time: { type:"string", description:"Желаемое время выезда, например '14:00', '15:00', '18:00'" },
    }}}},

  { type:"function", function:{ name:"request_room_extension",
    description:"Запрос продления проживания на 1 или более суток. Уточни кол-во ночей если не сказано.",
    parameters:{ type:"object", required:["room_number","extra_nights"],
    properties:{
      room_number:       { type:"string" },
      extra_nights:      { type:"number", description:"Количество дополнительных ночей" },
      new_checkout_date: { type:"string", description:"Новая дата выезда YYYY-MM-DD" },
    }}}},

  { type:"function", function:{ name:"escalate_to_human",
    description:"Соединить с живым администратором: жалобы, изменения брони, сложные вопросы, негативные эмоции, просьба поговорить с менеджером. Вызывай СРАЗУ — не пытайся решить сложные ситуации самостоятельно.",
    parameters:{ type:"object", required:["room_number","reason"],
    properties:{
      room_number:      { type:"string" },
      reason:           { type:"string", description:"Краткая причина эскалации (для администратора)" },
      guest_message:    { type:"string", description:"Что именно написал гость — для контекста администратору" },
      priority:         { type:"string", enum:["normal","urgent"], description:"normal — стандартный запрос, urgent — гость расстроен или ждёт немедленного ответа" },
    }}}},
];
