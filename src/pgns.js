// Garmin Race Timer PGN definition for canboatjs v3
// Handles 39-byte type 0x0002 timer data messages (1Hz broadcast)
// Garmin Race Timer PGN 126720 field definitions

module.exports = {
  PGNs: [
    {
      PGN: 126720,
      Id: "garminRaceTimer",
      Description: "Garmin Race Timer",
      Type: "Fast",
      Complete: false,
      Length: 39,
      RepeatingFields: 0,
      Fields: [
        {
          Order: 1,
          Id: "manufacturerCode",
          Name: "Manufacturer Code",
          Description: "Garmin",
          BitLength: 11,
          BitOffset: 0,
          BitStart: 0,
          Match: 229,
          FieldType: "LOOKUP",
          LookupEnumeration: "MANUFACTURER_CODE",
          Signed: false
        },
        {
          Order: 2,
          Id: "reserved",
          Name: "Reserved",
          BitLength: 2,
          BitOffset: 11,
          BitStart: 3,
          FieldType: "RESERVED"
        },
        {
          Order: 3,
          Id: "industryCode",
          Name: "Industry Code",
          Description: "Marine Industry",
          BitLength: 3,
          BitOffset: 13,
          BitStart: 5,
          Match: 4,
          FieldType: "LOOKUP",
          LookupEnumeration: "INDUSTRY_CODE",
          Signed: false
        },
        {
          Order: 4,
          Id: "command",
          Name: "Command",
          BitLength: 8,
          BitOffset: 16,
          BitStart: 0,
          Match: 254, // 0xFE = data exchange. Match is required so canboatjs selects this definition when other plugins also register PGN 126720 with competing Match values on the same field.
          FieldType: "NUMBER",
          Resolution: 1,
          Signed: false
        },
        {
          Order: 5,
          Id: "protocolVersion",
          Name: "Protocol Version",
          BitLength: 24,
          BitOffset: 24,
          BitStart: 0,
          FieldType: "BINARY",
          Signed: false
        },
        {
          Order: 6,
          Id: "deviceId",
          Name: "Device ID",
          BitLength: 32,
          BitOffset: 48,
          BitStart: 0,
          FieldType: "BINARY",
          Signed: false
        },
        {
          Order: 7,
          Id: "groupId",
          Name: "Group/Session ID",
          BitLength: 32,
          BitOffset: 80,
          BitStart: 0,
          FieldType: "BINARY",
          Signed: false
        },
        {
          Order: 8,
          Id: "messageType",
          Name: "Message Type",
          Description: "0x0002=timer, 0x0003=ack, 0x0004=sync, 0x0005=state, 0x0006=full, 0x0007=keepalive",
          BitLength: 16,
          BitOffset: 112,
          BitStart: 0,
          FieldType: "NUMBER",
          Resolution: 1,
          Signed: false
        },
        {
          Order: 9,
          Id: "payloadLength",
          Name: "Payload Length",
          BitLength: 8,
          BitOffset: 128,
          BitStart: 0,
          FieldType: "NUMBER",
          Resolution: 1,
          Signed: false
        },
        {
          Order: 10,
          Id: "timerEvents",
          Name: "Timer Events",
          BitLength: 128,
          BitOffset: 136,
          BitStart: 0,
          FieldType: "BINARY",
          Signed: false
        },
        {
          Order: 11,
          Id: "timerDataType",
          Name: "Timer Data Type",
          Description: "Always 0x05 for time data",
          BitLength: 8,
          BitOffset: 264,
          BitStart: 0,
          FieldType: "NUMBER",
          Resolution: 1,
          Signed: false
        },
        {
          Order: 12,
          Id: "timerValue",
          Name: "Timer Value",
          Description: "Countdown time remaining (ms) or elapsed race time (ms), depending on status",
          BitLength: 32,
          BitOffset: 272,
          BitStart: 0,
          Units: "ms",
          Resolution: 1,
          FieldType: "NUMBER",
          Signed: false
        },
        {
          Order: 13,
          Id: "timerStatus",
          Name: "Timer Status",
          Description: "0=Race Running, 1=Countdown Running, 2=Race Paused, 3=Countdown Paused",
          BitLength: 8,
          BitOffset: 304,
          BitStart: 0,
          FieldType: "NUMBER",
          Resolution: 1,
          Signed: false
        }
      ]
    }
  ]
}
