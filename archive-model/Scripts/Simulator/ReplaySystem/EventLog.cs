using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EventLog
{

    public GameEventType eventType;
    public float timeStamp;
}

public enum GameEventType
{
    Manuever = 0,
    Damage = 1,
    FX = 2,
    WeaponFire = 3,
    Transport = 4,
    Destruction = 5,
    Capture = 6,
    EndBattle = 7
}
