using System.Collections;
using System.Collections.Generic;
using UnityEngine;


[CreateAssetMenu(fileName = "WeaponIcon", menuName = "Weapons/WeaponIcon", order = 0)]
public class WeaponIcon : ScriptableObject
{
    public WeaponIconType weaponIconType;

    public Sprite icon_u;
    public Sprite icon_s;

    public string WeaponName = "Default Weapon";
}

public enum WeaponIconType {
    Beam = 1,
    Beam_Heavy = 2,
    Railgun = 3,
    Missile_light = 4,
    Missile_heavy = 5
}