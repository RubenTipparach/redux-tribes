using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "WeaponSystemColors", menuName = "Overlay/WeaponSystemColors")]
public class WeaponSystemColorConfigs : ScriptableObject
{
    public float radius = 2;

    public DiscColorsProp discColorsHorizontal;
    public DiscColorsProp discColorsHorizontalPie;

    public DiscColorsProp discColorsVertical;
    public DiscColorsProp discColorsVerticalPie;

    public CustomLineProperties targettingLine;


}
