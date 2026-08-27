using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "SubsytemIcons", menuName = "UIStuff/SubsytemIcons")]
public class SubsytemIcons : ScriptableObject
{
    public Sprite assignedSprite;
    public SubsystemType subsystemType;
    public Color subsystemColor;

}
