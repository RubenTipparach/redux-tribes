using System;
using UnityEngine;

[CreateAssetMenu(fileName = "WeaponData", menuName = "Weapons/WeaponData", order = 0)]
public class WeaponData : ScriptableObject
{
    public float damage = 1;
    public float range = 50f;
    public float cooldown = 1;


    public float weaponHealth = 10;

    public WeaponFXBasic weaponFx;

    public int shotCountPerRound = 3;

    public string id = Guid.NewGuid().ToString();

    public string GetCustomShipWeaponId(ShipController shipController, int index)
    {
        return $"{shipController.shipCardData.id}-W-{id}-I-{index}";
    }

}