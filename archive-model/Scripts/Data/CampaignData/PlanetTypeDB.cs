using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "PlanetDB", menuName = "Campaign/PlanetDB", order = 0)]
public class PlanetTypeDB : ScriptableObject
{
    public List<PlanetItemUI> planetItems;
}
