using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SubsystemColliderProxy : MonoBehaviour
{

    public ShipSubsystem subsystemDamageTarget;

    //todo add more stuff
    public void Damage(float damage, FiredEvent firedEvent)
    {
        Debug.Log($"hit a subsytem {subsystemDamageTarget.SubsystemName} {damage}");
        subsystemDamageTarget.Damage(damage, firedEvent, false);
        subsystemDamageTarget.onSubsystemHit?.Invoke();
    }

}
